// Acceptance tests for orchestration defects: hook commands with quotes, subscription deletion with decisions,
// publish-gate normalization, cron parsing, workflow queue limit, routines, hooks/evaluate permissions, overhang report. Requires `npm run build`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import {
  startServer,
  api as rawApi,
  login,
  createUser,
  toB64,
  ADMIN_PASSWORD,
} from "./lib/client.mjs";
import {
  nextRunAt,
  validateRoutineDefinition,
} from "../packages/server/dist/routines/schedule.js";

const servers = [];
after(async () => {
  for (const s of servers) {
    try {
      await s.stop?.();
    } catch (e) {
      if (e?.code === "EPERM") {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          rmSync(s.dataDir, { recursive: true, force: true });
        } catch {
          /* the temp directory stays in %TEMP% */
        }
      } else throw e;
    }
  }
});

const NODE = process.execPath;

const skillMd = (name, note = "") =>
  `---\nname: ${name}\ndescription: orchestration defects test\n---\n\n# ${name}\n${note}`;

// Hook artifact guard/* as in tests/hook-runtime.test.mjs.
const hookFiles = (hooks, ...scripts) => [
  { path: "guard/README.md", content: "# guard\n\nTest hook artifact.\n" },
  { path: "guard/hooks.json", content: JSON.stringify({ hooks }) },
  ...scripts,
];
const cmdEntry = (command, extra = {}) => ({ type: "command", command, timeout: 10, ...extra });
const preTool = (matcher, entries) => ({ PreToolUse: [{ matcher, hooks: entries }] });
const TYPED_BLOCK = {
  path: "guard/scripts/typed-block.js",
  content: `let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
    try{const j=JSON.parse(d);process.exit(j.tool_input&&j.tool_input.type==="skill"?2:0);}
    catch{process.exit(0)}
  });`,
};

async function mk(env = {}) {
  const srv = await startServer(
    { SKILLFORGE_ORCHESTRATION_ENABLED: "true", ...env },
    { prefix: "skillforge-od-" },
  );
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
  // Definitions (PUT/DELETE, enabling a routine) are saved by admin only; everything else — by the owner.
  const api = (m, p, b, who = m === "PUT" || m === "DELETE" ? "admin" : "alice", auth = undefined) =>
    rawApi(srv.base, m, p, b, auth ?? (who === "anon" ? {} : { cookie: U[who].cookie }));
  return {
    srv,
    api,
    U,
    A: (n, t = "skill") => `/api/v1/artifacts/${t}/${n}`,
    db: () => new DatabaseSync(join(srv.dataDir, "skillforge.db")),
  };
}

async function publishHook(api, name, files) {
  const r = await api(
    "POST",
    "/api/v1/artifacts",
    { type: "hook", name, version: "0.1.0", files: toB64(files) },
    "alice",
  );
  assert.equal(r.status, 201, `publish hook ${name}: ${JSON.stringify(r.data)}`);
}

const subscribe = (api, name) =>
  api("POST", "/api/v1/hooks/subscriptions", { type: "hook", name, version: "0.1.0" }, "admin");

const until = async (fn, { timeout = 15000, step = 200 } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, step));
  }
};

test("a hook command with quotes is executed verbatim — block, not error→ask", async () => {
  const { api } = await mk();
  await publishHook(
    api,
    "od-verbatim",
    hookFiles(preTool("artifact_publish", [cmdEntry('node -e "process.exit(2)"')])) ,
  );
  await subscribe(api, "od-verbatim");
  const r = await api(
    "POST",
    "/api/v1/hooks/evaluate",
    { event: "PreToolUse", tool_name: "artifact_publish" },
    "alice",
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(
    r.data.decision,
    "block",
    `a command with quotes must reach cmd verbatim: ${JSON.stringify(r.data.results)}`,
  );
});

test("DELETE of a subscription with decisions → 409 has_decisions; without decisions → 204", async () => {
  const { api } = await mk();
  await publishHook(
    api,
    "od-del",
    hookFiles(preTool("artifact_publish", [cmdEntry("node -e \"process.exit(0)\"")])),
  );
  await publishHook(api, "od-del2", hookFiles(preTool("x", [])));

  const s1 = await subscribe(api, "od-del");
  assert.equal(s1.status, 201);
  const s2 = await subscribe(api, "od-del2");
  assert.equal(s2.status, 201);

  // one evaluation → a record in hook_decisions
  const ev = await api(
    "POST",
    "/api/v1/hooks/evaluate",
    { event: "PreToolUse", tool_name: "artifact_publish" },
    "alice",
  );
  assert.equal(ev.status, 200);

  const list = await api("GET", "/api/v1/hooks/subscriptions", undefined, "admin");
  const used = list.data.items.find((s) => s.artifact_name === "od-del");
  const fresh = list.data.items.find((s) => s.artifact_name === "od-del2");

  const delUsed = await api("DELETE", `/api/v1/hooks/subscriptions/${used.id}`, undefined, "admin");
  assert.equal(delUsed.status, 409, JSON.stringify(delUsed.data));
  assert.equal(delUsed.data.error, "has_decisions");

  const delFresh = await api(
    "DELETE",
    `/api/v1/hooks/subscriptions/${fresh.id}`,
    undefined,
    "admin",
  );
  assert.equal(delFresh.status, 204, JSON.stringify(delFresh.data));
});

test("the publish gate receives normalized type/name (publish without explicit fields is blocked)", async () => {
  const { api } = await mk();
  await publishHook(
    api,
    "od-gate",
    hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/typed-block.js")]), TYPED_BLOCK),
  );
  await subscribe(api, "od-gate");

  // type is derived from the files: a hook blocking type==="skill" must fire.
  const r = await api("POST", "/api/v1/artifacts", {
    files: toB64([{ path: "od-blocked/SKILL.md", content: skillMd("od-blocked") }]),
  });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error, "publish_blocked");
});

test("imports/run goes through the publish gate (the candidate is not committed on block)", async () => {
  const { api } = await mk();
  await publishHook(
    api,
    "od-gate-i",
    hookFiles(preTool("artifact_publish", [cmdEntry("node scripts/typed-block.js")]), TYPED_BLOCK),
  );
  await subscribe(api, "od-gate-i");

  const preview = await api("POST", "/api/v1/imports/preview", {
    source: {
      kind: "files",
      files: toB64([{ path: "od-imp/SKILL.md", content: skillMd("od-imp") }]),
    },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const run = await api("POST", "/api/v1/imports/run", {
    import_id: preview.data.import_id,
    selected: "all",
    skip_conflicts: true,
  });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  const res = run.data.results.find((x) => x.name === "od-imp" || x.id === "skill/od-imp");
  assert.ok(res, JSON.stringify(run.data.results));
  assert.equal(res.status, "failed");
  assert.equal(res.reason, "publish_blocked", JSON.stringify(res));
});

test("cron — N/S = N..max, dom|dow combined with OR, an impossible cron is rejected", async () => {
  // N/S: "7/20" = 7,27,47 (not only :07).
  const t1 = nextRunAt(
    { kind: "cron", expr: "7/20 * * * *" },
    new Date("2026-01-01T00:08:00Z"),
  );
  assert.equal(t1, "2026-01-01T00:27:00.000Z", `7/20 after :08 → :27, got ${t1}`);

  // dom|dow: "0 12 1 * 4" = the 1st day OR Thursday → the nearest Thursday is 08.01.
  const t2 = nextRunAt(
    { kind: "cron", expr: "0 12 1 * 4" },
    new Date("2026-01-02T00:00:00Z"),
  );
  assert.equal(t2, "2026-01-08T12:00:00.000Z", `dom OR dow → 08.01, got ${t2}`);

  // impossible cron: February 31 is not valid and has no next trigger.
  const bad = validateRoutineDefinition({
    version: 1,
    schedule: { kind: "cron", expr: "0 0 31 2 *" },
    command: { argv: ["node", "-e", ""] },
  });
  assert.equal(bad.ok, false, `February 31 must be rejected: ${JSON.stringify(bad)}`);
  const t3 = nextRunAt({ kind: "cron", expr: "0 0 31 2 *" }, new Date("2026-01-01T00:00:00Z"));
  assert.equal(t3, null, `impossible cron → null, got ${t3}`);
});

test("workflows queue — limit of active runs per artifact → 429 queue_full", async () => {
  const { api, db } = await mk();
  const pub = await api("POST", "/api/v1/artifacts", {
    type: "skill",
    files: toB64([{ path: "od-qfull/SKILL.md", content: skillMd("od-qfull") }]),
  });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const DEF = {
    version: 1,
    name: "one",
    steps: [{ id: "s", kind: "command", argv: [NODE, "-e", "process.exit(0)"] }],
  };
  const put = await api("PUT", "/api/v1/artifacts/skill/od-qfull/workflows/pipe", {
    definition: DEF,
  });
  assert.equal(put.status, 200, JSON.stringify(put.data));

  const conn = db();
  const artifactId = conn
    .prepare("SELECT id FROM artifacts WHERE type='skill' AND name='od-qfull'")
    .get().id;
  const now = new Date().toISOString();
  const ins = conn.prepare(
    `INSERT INTO workflow_runs (artifact_id, workflow_id, status, def_json, requested_by, created_at)
     VALUES (?, 'pipe', 'queued', '{}', 'alice', ?)`,
  );
  for (let i = 0; i < 10; i++) ins.run(artifactId, now);
  conn.close();

  const r = await api("POST", "/api/v1/artifacts/skill/od-qfull/workflows/pipe/runs", {}, "alice");
  assert.equal(r.status, 429, JSON.stringify(r.data));
  assert.equal(r.data.error, "queue_full");
});

test("routines — enable resets failures; a run of a disabled routine → skipped", async () => {
  const { api, db } = await mk();
  const pub = await api("POST", "/api/v1/artifacts", {
    type: "skill",
    files: toB64([{ path: "od-rt/SKILL.md", content: skillMd("od-rt") }]),
  });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const DEF = {
    version: 1,
    enabled: false,
    schedule: { kind: "every", seconds: 3600 },
    command: { argv: [NODE, "-e", "process.exit(0)"] },
  };
  const put = await api("PUT", "/api/v1/artifacts/skill/od-rt/routines/main", {
    definition: DEF,
  });
  assert.equal(put.status, 200, JSON.stringify(put.data));

  const conn = db();
  conn
    .prepare("UPDATE routines SET consecutive_failures = 4 WHERE routine_id = 'main'")
    .run();
  conn.close();

  const en = await api("POST", "/api/v1/artifacts/skill/od-rt/routines/main/enable", {}, "admin");
  assert.equal(en.status, 200, JSON.stringify(en.data));
  const got = await api("GET", "/api/v1/artifacts/skill/od-rt/routines/main", undefined, "alice");
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.routine.consecutive_failures, 0, "enable resets the counter");

  await api("POST", "/api/v1/artifacts/skill/od-rt/routines/main/disable", {}, "alice");
  const started = await api("POST", "/api/v1/artifacts/skill/od-rt/routines/main/run", {}, "alice");
  assert.equal(started.status, 202, JSON.stringify(started.data));
  const runId = started.data.run.id;
  const done = await until(async () => {
    const r = await api(
      "GET",
      `/api/v1/artifacts/skill/od-rt/routines/runs/${runId}`,
      undefined,
      "alice",
    );
    return r.data?.run && !["queued", "running"].includes(r.data.run.status)
      ? r.data.run
      : null;
  });
  assert.ok(done, "run did not finish");
  assert.equal(done.status, "skipped", `disabled routine → skipped, got ${done.status}`);
});

test("hooks/evaluate — viewer and MCP token → 403; overhang — MCP token → 403", async () => {
  const { api } = await mk();
  const tok = await api("POST", "/api/v1/me/tokens", { name: "mcp-od", mcp: true }, "alice");
  assert.equal(tok.status, 201, JSON.stringify(tok.data));
  const token = tok.data.token ?? tok.data.api_token ?? tok.data.value;
  assert.ok(token, JSON.stringify(tok.data));

  const viewerEval = await api(
    "POST",
    "/api/v1/hooks/evaluate",
    { event: "PreToolUse" },
    "vera",
  );
  assert.equal(viewerEval.status, 403, `viewer: ${JSON.stringify(viewerEval.data)}`);

  const mcpEval = await api(
    "POST",
    "/api/v1/hooks/evaluate",
    { event: "PreToolUse" },
    undefined,
    { token },
  );
  assert.equal(mcpEval.status, 403, `mcp: ${JSON.stringify(mcpEval.data)}`);
  assert.equal(mcpEval.data.error, "mcp_token_forbidden");

  const mcpOverhang = await api("GET", "/api/v1/lifecycle/overhang", undefined, undefined, {
    token,
  });
  assert.equal(mcpOverhang.status, 403, `overhang mcp: ${JSON.stringify(mcpOverhang.data)}`);
});

test("overhang report picks candidates not by update recency", async () => {
  const { api, db } = await mk();
  const conn = db();
  const now = new Date().toISOString();
  const insArt = conn.prepare(
    `INSERT INTO artifacts (id, type, name, description, tags, status, visibility, created_by, created_at, updated_at, owner)
     VALUES (?, 'skill', ?, '', '[]', 'active', 'org', 'seed', ?, ?, 'seed')`,
  );
  // The main candidate is the artifact with the oldest updated_at having ablation uplift<=0.
  insArt.run("art-stale", "od-stale-overhang", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z");
  conn
    .prepare(
      `INSERT INTO artifact_versions
         (id, artifact_id, version, digest, description, tags, files, warnings, model_compat,
          provenance, evidence, published_by, published_at)
       VALUES ('v-stale', 'art-stale', '0.1.0', 'sha-stale', '', '[]', '[]', '[]', '[]',
          '{}', ?, 'seed', '2020-01-01T00:00:00Z')`,
    )
    .run(
      JSON.stringify([
        {
          kind: "ablation",
          at: "2020-01-01T00:00:00Z",
          by: "seed",
          data: { tasks: 12, passed_with: 3, passed_without: 8, uplift: -0.4 },
        },
      ]),
    );
  // 450 fresh artifacts push the candidate out of the "200 latest by updated_at" window.
  for (let i = 0; i < 450; i++) {
    insArt.run(`art-fill-${i}`, `od-fill-${i}`, now, now);
  }
  conn.close();

  const r = await api("GET", "/api/v1/lifecycle/overhang", undefined, "rita");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const names = r.data.items.map((x) => x.name);
  assert.ok(
    names.includes("od-stale-overhang"),
    `an old artifact with ablation uplift<=0 must be in the report; got ${names.length} entries`,
  );
});
