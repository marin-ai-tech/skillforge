// Acceptance tests for the hook runtime (subscriptions, evaluation, gate, materialization).
// Requires `npm run build`.
// Hooks run `node scripts/*.js`: cross-platform, with no external runtimes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  startServer,
  api as rawApi,
  login,
  createUser,
  toB64,
  ADMIN_PASSWORD,
} from "./lib/client.mjs";

const servers = [];
after(async () => {
  for (const s of servers) {
    // Windows: rmSync of dataDir fails with EPERM while the OS releases the server DB files,
    // so stopping the server is mandatory and removing the temp directory is best-effort (the OS sweeps it).
    try {
      await s.stop?.();
    } catch (e) {
      if (e?.code === "EPERM") {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          rmSync(s.dataDir, { recursive: true, force: true });
        } catch {
          /* the temp directory stays in %TEMP%; not a product defect */
        }
      } else throw e;
    }
  }
});

import { rmSync } from "node:fs";

// --- hook artifact builders ------------------------------------------------

const script = (name, code) => ({ path: `guard/scripts/${name}`, content: code });
const readme = () => ({
  path: "guard/README.md",
  content: "# guard\n\nTest hook artifact.\n",
});
const hooksJson = (hooks) => ({
  path: "guard/hooks.json",
  content: JSON.stringify({ hooks }, null, 2),
});
const hookFiles = (hooks, ...scripts) => [readme(), hooksJson(hooks), ...scripts];

const cmdEntry = (command, extra = {}) => ({ type: "command", command, timeout: 10, ...extra });
const preTool = (matcher, entries) => ({ PreToolUse: [{ matcher, hooks: entries }] });

const ASK_SCRIPT = script(
  "ask.js",
  `let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{process.stdout.write('{"decision":"ask"}')});`,
);
const BLOCK_SCRIPT = script("block.js", `process.exit(2)`);
const FAIL_SCRIPT = script("fail.js", `process.exit(5)`);
const ALLOW_SCRIPT = script("allow.js", `process.exit(0)`);
const MARK_SCRIPT = script(
  "mark.js",
  `const fs=require("fs");fs.writeFileSync("mark.txt",process.env.CLAUDE_PLUGIN_ROOT||"none");`,
);

const publishHook = async (h, name, files, version = "0.1.0") => {
  const r = await h.api(
    "POST",
    "/api/v1/artifacts",
    { type: "hook", name, version, files: toB64(files) },
    "alice",
  );
  assert.equal(r.status, 201, `publish hook ${name}: ${JSON.stringify(r.data)}`);
};

const subscribe = async (h, name, version = "0.1.0", who = "admin") =>
  h.api("POST", "/api/v1/hooks/subscriptions", { type: "hook", name, version }, who);

const skillMd = (name) =>
  `---\nname: ${name}\ndescription: hook gate test skill\n---\n\n# ${name}\n`;
const publishSkill = (h, name, who = "alice") =>
  h.api(
    "POST",
    "/api/v1/artifacts",
    { type: "skill", files: toB64([{ path: `${name}/SKILL.md`, content: skillMd(name) }]) },
    who,
  );

async function mk(env = {}) {
  const srv = await startServer({ SKILLFORGE_ORCHESTRATION_ENABLED: "true", ...env }, { prefix: "skillforge-ht-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  servers.push(srv);
  const U = {};
  U.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [
    ["alice", "contributor"],
    ["rita", "reviewer"],
    ["vera", "viewer"],
  ]) {
    await createUser(srv.base, U.admin.cookie, {
      username: u,
      password: `${u}-pw-123`,
      role,
    });
    U[u] = await login(srv.base, u, `${u}-pw-123`);
  }
  const api = (method, path, body, who = "alice") =>
    rawApi(srv.base, method, path, body, who === "anon" ? {} : { cookie: U[who].cookie });
  return {
    srv,
    api,
    U,
    A: (n, t = "skill") => `/api/v1/artifacts/${t}/${n}`,
    db: () => new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true }),
    evaluate: (body, who = "alice") => api("POST", "/api/v1/hooks/evaluate", body, who),
    decisions: (who = "admin") => api("GET", "/api/v1/hooks/decisions", undefined, who),
    envDirOf: () => join(srv.dataDir, "hook-env"),
  };
}

test("subscriptions: admin CRUD, audit, permissions", async () => {
  const h = await mk();
  await publishHook(h, "guard-sub", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/allow.js")]), ALLOW_SCRIPT));

  const anon = await h.api("POST", "/api/v1/hooks/subscriptions", { type: "hook", name: "guard-sub", version: "0.1.0" }, "anon");
  assert.equal(anon.status, 401);
  for (const who of ["alice", "rita", "vera"]) {
    const r = await subscribe(h, "guard-sub", "0.1.0", who);
    assert.equal(r.status, 403, `${who}: ${JSON.stringify(r.data)}`);
  }
  const ok = await subscribe(h, "guard-sub");
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const list = await h.api("GET", "/api/v1/hooks/subscriptions", undefined, "admin");
  assert.equal(list.status, 200);
  const sub = list.data.items.find((s) => s.artifact_name === "guard-sub");
  assert.ok(sub, "subscription is in the list");
  assert.equal(sub.enabled, 1);

  const audit = await h.api("GET", `${h.A("guard-sub", "hook")}/audit`, undefined, "admin");
  assert.ok(audit.data.items.some((e) => e.action === "hook_subscribed"), "hook_subscribed audit");

  const del = await h.api("DELETE", `/api/v1/hooks/subscriptions/${sub.id}`, undefined, "admin");
  assert.ok([200, 204].includes(del.status), JSON.stringify(del.data));
  const audit2 = await h.api("GET", `${h.A("guard-sub", "hook")}/audit`, undefined, "admin");
  assert.ok(audit2.data.items.some((e) => e.action === "hook_unsubscribed"), "hook_unsubscribed audit");
});

test("evaluate: ask path, verdict and decision log", async () => {
  const h = await mk();
  await publishHook(h, "guard-ask", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/ask.js")]), ASK_SCRIPT));
  const sub = await subscribe(h, "guard-ask");
  assert.equal(sub.status, 201);

  const anon = await h.evaluate({ event: "PreToolUse", tool_name: "artifact_publish" }, "anon");
  assert.equal(anon.status, 401);

  const r = await h.evaluate({ event: "PreToolUse", tool_name: "artifact_publish", input: { type: "skill" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.decision, "ask");
  assert.ok(r.data.results.some((x) => x.verdict === "ask"), "verdict ask in results");

  const dec = await h.decisions("admin");
  assert.equal(dec.status, 200);
  assert.ok(dec.data.items.some((d) => d.verdict === "ask" && d.event === "PreToolUse"), "decision is in the log");
  const decReviewer = await h.decisions("rita");
  assert.equal(decReviewer.status, 200);
  const decViewer = await h.decisions("alice");
  assert.equal(decViewer.status, 403);
});

test("verdicts: block aggregates; error -> ask", async () => {
  const h = await mk();
  await publishHook(h, "guard-block", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/block.js")]), BLOCK_SCRIPT));
  await publishHook(h, "guard-fail", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/fail.js")]), FAIL_SCRIPT));
  await subscribe(h, "guard-block");
  const subFail = await subscribe(h, "guard-fail");
  assert.equal(subFail.status, 201);

  const r = await h.evaluate({ event: "PreToolUse", tool_name: "artifact_publish" });
  assert.equal(r.data.decision, "block", JSON.stringify(r.data));
  const dec = await h.decisions();
  const verdicts = dec.data.items.map((d) => d.verdict);
  assert.ok(verdicts.includes("block"), "block is in the log");
  assert.ok(verdicts.includes("error"), "error is in the log");

  // turn off the blocking one: error remains -> aggregate is ask
  const list = await h.api("GET", "/api/v1/hooks/subscriptions", undefined, "admin");
  const blockSub = list.data.items.find((s) => s.artifact_name === "guard-block");
  const d = await h.api("POST", `/api/v1/hooks/subscriptions/${blockSub.id}/disable`, {}, "admin");
  assert.equal(d.status, 200);
  const r2 = await h.evaluate({ event: "PreToolUse", tool_name: "artifact_publish" });
  assert.equal(r2.data.decision, "ask", "error aggregates as ask, not block");
});

test("matcher and events: filtering; prompt-entry -> skipped", async () => {
  const h = await mk();
  const hooks = {
    PreToolUse: [{ matcher: "Bash", hooks: [cmdEntry("node scripts/block.js")] }],
    Stop: [{ hooks: [{ type: "prompt", prompt: "check things" }] }],
  };
  await publishHook(h, "guard-match", hookFiles(hooks, BLOCK_SCRIPT));
  await subscribe(h, "guard-match");

  const noMatch = await h.evaluate({ event: "PreToolUse", tool_name: "artifact_publish" });
  assert.equal(noMatch.data.decision, "allow");
  const matched = await h.evaluate({ event: "PreToolUse", tool_name: "Bash" });
  assert.equal(matched.data.decision, "block");
  const promptEv = await h.evaluate({ event: "Stop", tool_name: "x" });
  assert.equal(promptEv.data.decision, "allow");
  const dec = await h.decisions();
  assert.ok(dec.data.items.some((d) => d.verdict === "skipped"), "prompt-entry -> skipped in the log");
});

test("publish gate: block → 409 publish_blocked", async () => {
  const h = await mk();
  await publishHook(h, "guard-veto", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/block.js")]), BLOCK_SCRIPT));
  const sub0 = await subscribe(h, "guard-veto");
  assert.equal(sub0.status, 201, JSON.stringify(sub0.data));

  const blocked = await publishSkill(h, "ht-blocked");
  if (blocked.status !== 409) {
    const dec = await h.decisions();
    assert.fail(`${blocked.status}; decisions: ${JSON.stringify(dec.data.items)}`);
  }
  assert.equal(blocked.data.error, "publish_blocked");

  const list = await h.api("GET", "/api/v1/hooks/subscriptions", undefined, "admin");
  const sub = list.data.items.find((s) => s.artifact_name === "guard-veto");
  await h.api("POST", `/api/v1/hooks/subscriptions/${sub.id}/disable`, {}, "admin");
  const ok = await publishSkill(h, "ht-blocked");
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});

/** The on-disk blob of a file of a published hook version (hook-gate-fail-closed, #127). */
async function blobOf(h, name, suffix) {
  const v = await h.api("GET", `/api/v1/artifacts/hook/${name}/versions/0.1.0`, undefined, "admin");
  assert.equal(v.status, 200, JSON.stringify(v.data));
  const f = v.data.files.find((x) => x.path.endsWith(suffix));
  assert.ok(f, `missing file ${suffix}: ${JSON.stringify(v.data.files)}`);
  return join(h.srv.dataDir, "blobs", f.sha256.slice(0, 2), f.sha256);
}
async function subscribed(h, name) {
  const s = await subscribe(h, name);
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return s.data.subscription;
}
function assertUnavailable(h, r) {
  assert.equal(r.status, 409, JSON.stringify(r.data).slice(0, 400));
  assert.equal(r.data.error, "publish_blocked");
  const item = r.data.results.find((x) => x.verdict === "block");
  assert.ok(item, JSON.stringify(r.data.results));
  assert.match(item.detail ?? "", /^hook unavailable:/);
  assert.ok(!JSON.stringify(r.data).includes(h.srv.dataDir), "the response reveals the data directory");
}

test("gate fails closed on its own error: a corrupted definition -> 409 and a log entry; disabling the subscription lifts the block", async () => {
  const h = await mk();
  await publishHook(h, "guard-corrupt", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/allow.js")]), ALLOW_SCRIPT));
  const sub = await subscribed(h, "guard-corrupt");
  writeFileSync(await blobOf(h, "guard-corrupt", "hooks/hooks.json"), "{ not json");

  assertUnavailable(h, await publishSkill(h, "ht-corrupt"));
  const dec = await h.decisions();
  assert.ok(dec.data.items.some((d) => d.verdict === "block" && /^hook unavailable:/.test(d.detail ?? "")), JSON.stringify(dec.data.items));

  const off = await h.api("POST", `/api/v1/hooks/subscriptions/${sub.id}/disable`, {}, "admin");
  assert.equal(off.status, 200);
  assert.equal((await publishSkill(h, "ht-corrupt")).status, 201);
});

test("gate fails closed on its own error: a deleted definition and a deleted script -> 409", async () => {
  const h = await mk();
  await publishHook(h, "guard-gone", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/allow.js")]), ALLOW_SCRIPT));
  const gone = await subscribed(h, "guard-gone");
  const blob = await blobOf(h, "guard-gone", "hooks/hooks.json");
  rmSync(blob);
  assertUnavailable(h, await publishSkill(h, "ht-gone"));
  await h.api("POST", `/api/v1/hooks/subscriptions/${gone.id}/disable`, {}, "admin");

  await publishHook(h, "guard-noscript", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/mark.js")]), MARK_SCRIPT));
  const script = await blobOf(h, "guard-noscript", "scripts/mark.js");
  await subscribed(h, "guard-noscript");
  rmSync(script);
  assertUnavailable(h, await publishSkill(h, "ht-noscript"));
});

test("gate: a file vanished after the first evaluation and is restored from the blob; no blob -> 409", async () => {
  const h = await mk();
  await publishHook(h, "guard-heal", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/allow.js")]), ALLOW_SCRIPT));
  const sub = await subscribed(h, "guard-heal");
  assert.equal((await publishSkill(h, "ht-heal-1")).status, 201);
  const onDisk = join(h.envDirOf(), String(sub.id), "scripts", "allow.js");
  assert.ok(existsSync(onDisk), onDisk);

  rmSync(onDisk);
  const healed = await publishSkill(h, "ht-heal-2");
  assert.equal(healed.status, 201, JSON.stringify(healed.data));
  assert.equal(healed.data.hooks, undefined, "the script is restored, the hook must not fail");

  rmSync(onDisk);
  rmSync(await blobOf(h, "guard-heal", "scripts/allow.js"));
  assertUnavailable(h, await publishSkill(h, "ht-heal-3"));
});

test("gate: the hook process did not start (no shell) -> 409", async () => {
  const h = await mk({ PATH: "/nonexistent", ComSpec: "C:\\nonexistent\\cmd.exe" });
  await publishHook(h, "guard-nosh", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/allow.js")]), ALLOW_SCRIPT));
  await subscribed(h, "guard-nosh");
  assertUnavailable(h, await publishSkill(h, "ht-nosh"));
});

test("gate: an intact hook with no matching group -> 201 without hooks; a hook with exit code 5 -> 201 and ask; a hook error does not become block", async () => {
  const h = await mk();
  await publishHook(h, "guard-other", hookFiles(preTool("SomeOtherTool", [cmdEntry("node scripts/block.js")]), BLOCK_SCRIPT));
  const other = await subscribed(h, "guard-other");
  const quiet = await publishSkill(h, "ht-quiet");
  assert.equal(quiet.status, 201, JSON.stringify(quiet.data));
  assert.equal(quiet.data.hooks, undefined);
  await h.api("POST", `/api/v1/hooks/subscriptions/${other.id}/disable`, {}, "admin");

  await publishHook(h, "guard-five", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/fail.js")]), FAIL_SCRIPT));
  await subscribed(h, "guard-five");
  const asked = await publishSkill(h, "ht-five");
  assert.equal(asked.status, 201, JSON.stringify(asked.data));
  assert.equal(asked.data.hooks?.decision, "ask");
});

test("publish gate: ask → 201 + hooks.decision («ask, not deny»)", async () => {
  const h = await mk();
  await publishHook(h, "guard-askpub", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/ask.js")]), ASK_SCRIPT));
  await subscribe(h, "guard-askpub");

  const r = await publishSkill(h, "ht-asked");
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.hooks?.decision, "ask", "the publish response carries hooks.decision=ask");
});

test("agent path: publish from an agent inventory goes through the gate", async () => {
  const h = await mk();
  await publishHook(h, "guard-agent", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/block.js")]), BLOCK_SCRIPT));
  await subscribe(h, "guard-agent");

  // upload agent with a local skill
  const put = await h.api("PUT", "/api/v1/me/agents/laptop", {
    files: toB64([{ path: "skills/local-x/SKILL.md", content: skillMd("local-x") }]),
  });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  const blocked = await h.api("POST", "/api/v1/me/agents/laptop/items/skill/local-x/publish", {});
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.equal(blocked.data.error, "publish_blocked");
});

test("materialization: version files in the env directory, CLAUDE_PLUGIN_ROOT", async () => {
  const h = await mk();
  const hooks = preTool("artifact_publish", [
    cmdEntry('node "${CLAUDE_PLUGIN_ROOT}/scripts/noop.js"'),
    cmdEntry("node scripts/mark.js"),
  ]);
  await publishHook(
    h,
    "guard-env",
    hookFiles(hooks, MARK_SCRIPT, script("noop.js", "process.exit(0)")),
  );
  await subscribe(h, "guard-env");
  const r = await h.evaluate({ event: "PreToolUse", tool_name: "artifact_publish" });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const envDir = h.envDirOf();
  assert.ok(existsSync(envDir), "hook-env directory was created");
  const subDirs = readdirSync(envDir);
  assert.equal(subDirs.length, 1);
  assert.ok(existsSync(join(envDir, subDirs[0], "mark.txt")), "the script wrote into the env directory (cwd)");
  assert.ok(existsSync(join(envDir, subDirs[0], "scripts", "mark.js")), "version files are materialized");
});

test("purge: subscriptions, decisions and the env directory are cleared", async () => {
  const h = await mk();
  await publishHook(h, "guard-purge", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/mark.js")]), MARK_SCRIPT));
  await subscribe(h, "guard-purge");
  await h.evaluate({ event: "PreToolUse", tool_name: "artifact_publish" });

  const db = h.db();
  for (const t of ["hook_subscriptions", "hook_decisions"]) {
    assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n > 0, `${t} is populated`);
  }
  const envDir = h.envDirOf();
  assert.ok(existsSync(envDir) && readdirSync(envDir).length > 0, "env directory exists");

  const p = await h.api(
    "POST",
    `${h.A("guard-purge", "hook")}/purge`,
    { confirm: "hook/guard-purge", reason: "hook runtime test cleanup" },
    "admin",
  );
  assert.equal(p.status, 200, JSON.stringify(p.data));
  for (const t of ["hook_subscriptions", "hook_decisions"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} is cleared`);
  }
  assert.ok(!existsSync(envDir) || readdirSync(envDir).length === 0, "env directories removed by purge");
});

test("kill switch: SKILLFORGE_HOOKS_DISABLED -> allow without records", async () => {
  const h = await mk({ SKILLFORGE_HOOKS_DISABLED: "1" });
  await publishHook(h, "guard-off", hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/block.js")]), BLOCK_SCRIPT));
  await subscribe(h, "guard-off");
  const r = await h.evaluate({ event: "PreToolUse", tool_name: "artifact_publish" });
  assert.equal(r.data.decision, "allow");
  const dec = await h.decisions();
  assert.equal(dec.data.items.length, 0, "no decisions while the runtime is disabled");
});
