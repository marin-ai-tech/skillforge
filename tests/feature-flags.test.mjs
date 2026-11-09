// All boolean environment variables are parsed the same way — `true`/`false`/`1`/`0`; any other value makes startup fail with the variable name.
// The main case is the kill switches: `SKILLFORGE_ROUTINES_DISABLED=true` and `SKILLFORGE_HOOKS_DISABLED=true`
// used to be silently ignored (only `1` took effect).
// Requires `npm run build`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { startServer, api, login, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const servers = [];
after(async () => {
  for (const s of servers) {
    try {
      await s.stop?.();
    } catch (e) {
      if (e?.code !== "EPERM") throw e;
      // Windows: the DB files are still busy — the OS will sweep the temp directory.
      try {
        rmSync(s.dataDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }
});

async function boot(env) {
  const srv = await startServer(env, { prefix: "skillforge-flags-" });
  if (srv.up) servers.push(srv);
  return srv;
}

const until = async (fn, { timeout = 20_000, step = 200 } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, step));
  }
};

const NODE = process.execPath;

test("ORCHESTRATION_ENABLED: 1 and 0 work as true and false", { timeout: 90_000 }, async () => {
  for (const [raw, expected] of [["1", true], ["0", false], ["true", true], ["false", false]]) {
    const srv = await boot({ SKILLFORGE_ORCHESTRATION_ENABLED: raw });
    assert.ok(srv.up, `=${raw}: server did not start: ${srv.stderr}`);
    const h = await api(srv.base, "GET", "/api/v1/health");
    assert.equal(h.data.orchestration_enabled, expected, `=${raw}`);
    await srv.stop();
    servers.splice(servers.indexOf(srv), 1);
  }
});

test("PUBLIC_READ=0 and PLUGINS_DISABLED=1 are accepted by the same parsing", { timeout: 60_000 }, async () => {
  const srv = await boot({ SKILLFORGE_PUBLIC_READ: "0", SKILLFORGE_PLUGINS_DISABLED: "1" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  const anon = await api(srv.base, "GET", "/api/v1/artifacts");
  assert.equal(anon.status, 401, "PUBLIC_READ=0 must close reading to anonymous users");
  const h = await api(srv.base, "GET", "/api/v1/health");
  assert.equal(h.data.plugins.loaded, 0);
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  const list = await api(srv.base, "GET", "/api/v1/admin/plugins", undefined, admin);
  assert.equal(list.data.disabled, true, "PLUGINS_DISABLED=1 must disable plugins");
});

test("an invalid value of any boolean flag — startup fails with the variable name", { timeout: 180_000 }, async () => {
  for (const name of [
    "SKILLFORGE_ORCHESTRATION_ENABLED",
    "SKILLFORGE_ROUTINES_DISABLED",
    "SKILLFORGE_HOOKS_DISABLED",
    "SKILLFORGE_PLUGINS_DISABLED",
    "SKILLFORGE_PUBLIC_READ",
    "SKILLFORGE_SAFE_ERRORS",
    "SKILLFORGE_IMPORT_GIT",
  ]) {
    const srv = await boot({ [name]: "yes" });
    assert.equal(srv.up, false, `${name}=yes: server started but must refuse`);
    assert.notEqual(srv.exitCode, 0, `${name}=yes: exit code 0`);
    assert.match(srv.stderr, new RegExp(name), `${name}=yes: stderr has no variable name: ${srv.stderr}`);
  }
});

test("ROUTINES_DISABLED=true stops scheduled triggers (control: without the flag they occur)", { timeout: 120_000 }, async () => {
  const skill = (name) => `---\nname: ${name}\ndescription: Flags test skill\n---\n\n# ${name}\n`;
  const scheduledRuns = async (disabled) => {
    const env = { SKILLFORGE_ORCHESTRATION_ENABLED: "true" };
    if (disabled !== undefined) env.SKILLFORGE_ROUTINES_DISABLED = disabled;
    const srv = await boot(env);
    assert.ok(srv.up, `server did not start: ${srv.stderr}`);
    const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
    const pub = await api(srv.base, "POST", "/api/v1/artifacts", {
      type: "skill",
      version: "0.1.0",
      files: toB64([{ path: "flag-rt/SKILL.md", content: skill("flag-rt") }]),
    }, admin);
    assert.equal(pub.status, 201, JSON.stringify(pub.data));
    const save = await api(srv.base, "PUT", "/api/v1/artifacts/skill/flag-rt/routines/tick", {
      definition: { version: 1, schedule: { kind: "every", seconds: 1 }, command: { argv: [NODE, "-e", "1"] } },
    }, admin);
    assert.equal(save.status, 200, JSON.stringify(save.data));
    const runs = async () => {
      const r = await api(srv.base, "GET", "/api/v1/artifacts/skill/flag-rt/routines/runs", undefined, admin);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      return r.data.items.filter((x) => x.trigger === "schedule");
    };
    return { runs };
  };

  // Control: without the kill switch scheduled triggers appear (otherwise the check below is vacuous).
  const on = await scheduledRuns(undefined);
  const seen = await until(async () => ((await on.runs()).length > 0 ? true : null));
  assert.ok(seen, "control: without ROUTINES_DISABLED no run with trigger=schedule appeared");

  for (const value of ["true", "1"]) {
    const off = await scheduledRuns(value);
    await new Promise((r) => setTimeout(r, 4000));
    assert.deepEqual(await off.runs(), [], `ROUTINES_DISABLED=${value}: scheduled runs still happen`);
  }
});

test("HOOKS_DISABLED=true: evaluate → allow without records under a blocking subscription (control: without the flag block)", { timeout: 120_000 }, async () => {
  const files = [
    { path: "guard/README.md", content: "# guard\n\nFlags test hook.\n" },
    {
      path: "guard/hooks.json",
      content: JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "artifact_publish", hooks: [{ type: "command", command: "node scripts/block.js", timeout: 10 }] }] },
      }),
    },
    { path: "guard/scripts/block.js", content: "process.exit(2)" },
  ];
  const evaluateWith = async (disabled) => {
    const env = { SKILLFORGE_ORCHESTRATION_ENABLED: "true" };
    if (disabled !== undefined) env.SKILLFORGE_HOOKS_DISABLED = disabled;
    const srv = await boot(env);
    assert.ok(srv.up, `server did not start: ${srv.stderr}`);
    const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
    const pub = await api(srv.base, "POST", "/api/v1/artifacts", { type: "hook", name: "flag-guard", version: "0.1.0", files: toB64(files) }, admin);
    assert.equal(pub.status, 201, JSON.stringify(pub.data));
    const sub = await api(srv.base, "POST", "/api/v1/hooks/subscriptions", { type: "hook", name: "flag-guard", version: "0.1.0" }, admin);
    assert.ok([200, 201].includes(sub.status), JSON.stringify(sub.data));
    const r = await api(srv.base, "POST", "/api/v1/hooks/evaluate", { event: "PreToolUse", tool_name: "artifact_publish" }, admin);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };

  const control = await evaluateWith(undefined);
  assert.equal(control.decision, "block", `control: without HOOKS_DISABLED block was expected: ${JSON.stringify(control)}`);

  for (const value of ["true", "1"]) {
    const res = await evaluateWith(value);
    assert.equal(res.decision, "allow", `HOOKS_DISABLED=${value}: ${JSON.stringify(res)}`);
    assert.deepEqual(res.results, [], `HOOKS_DISABLED=${value}: hooks were executed`);
  }
});
