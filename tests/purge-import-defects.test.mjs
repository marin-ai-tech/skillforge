// Purge and import defects.
// purge of a baseline version must not fail on the eval_batch_runs FK.
// run records after a purge do not write run_outputs/files of the erased artifact.
// import run does not reveal the owner of someone else's team artifact.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync } from "node:fs";
import {
  startServer,
  api as rawApi,
  login,
  createUser,
  toB64,
  ADMIN_PASSWORD,
} from "./lib/client.mjs";
import { recordRunOutputs } from "../packages/server/dist/runs/outputs.js";

const servers = [];
after(async () => {
  for (const s of servers) await s.stop?.();
});

const skillMd = (name, note = "") =>
  `---\nname: ${name}\ndescription: Purge/import defects test\n---\n\n# ${name}\n${note}`;

async function mk() {
  const srv = await startServer({}, { prefix: "skillforge-pid-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  servers.push(srv);
  const U = {};
  U.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [
    ["alice", "contributor"],
    ["bob", "contributor"],
  ]) {
    await createUser(srv.base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    U[u] = await login(srv.base, u, `${u}-pw-123`);
  }
  const api = (m, p, b, who = "admin") => rawApi(srv.base, m, p, b, { cookie: U[who].cookie });
  const db = () => new DatabaseSync(join(srv.dataDir, "skillforge.db"));
  return { srv, api, U, db };
}

async function publish(api, name, note = "", who = "admin") {
  const r = await api("POST", "/api/v1/artifacts", {
    type: "skill",
    files: toB64([{ path: `${name}/SKILL.md`, content: skillMd(name, note) }]),
  }, who);
  assert.equal(r.status, 201, JSON.stringify(r.data));
}

test("purge of a baseline version does not fail on the eval_batch_runs FK", async () => {
  const { srv, api, db } = await mk();
  await publish(api, "pid-baseline", "", "alice");
  await publish(api, "pid-baseline", "<!-- v2 -->\n", "alice");

  const conn = db();
  const artifactId = conn
    .prepare("SELECT id FROM artifacts WHERE type='skill' AND name='pid-baseline'")
    .get().id;
  const now = new Date().toISOString();
  const batch = conn
    .prepare(
      `INSERT INTO eval_batches (artifact_id, version, kind, scope, against, runners, status, requested_by, created_at, started_at, finished_at)
       VALUES (?, '0.2.0', 'ablation', 'full', '0.1.0', '["mock-a"]', 'done', 'alice', ?, ?, ?)`,
    )
    .run(artifactId, now, now, now);
  const run = conn
    .prepare(
      `INSERT INTO eval_runs (artifact_id, kind, version, against, runner, scope, status, requested_by, created_at, started_at, finished_at, errors)
       VALUES (?, 'ablation', '0.2.0', '0.1.0', 'mock-a', 'full', 'done', 'alice', ?, ?, ?, 0)`,
    )
    .run(artifactId, now, now, now);
  conn
    .prepare("INSERT INTO eval_batch_runs (batch_id, run_id, runner) VALUES (?, ?, 'mock-a')")
    .run(Number(batch.lastInsertRowid), Number(run.lastInsertRowid));
  conn
    .prepare(
      `INSERT INTO eval_results (run_id, case_id, side, passed, triggered, duration_ms)
       VALUES (?, 'c1', 'candidate', 1, 1, 10)`,
    )
    .run(Number(run.lastInsertRowid));
  conn.close();

  const r = await api(
    "POST",
    "/api/v1/artifacts/skill/pid-baseline/versions/0.1.0/purge",
    { reason: "baseline leaked a secret", confirm: "skill/pid-baseline@0.1.0" },
    "admin",
  );
  assert.equal(r.status, 200, `purge of a baseline version: ${r.status} ${JSON.stringify(r.data)}`);

  const conn2 = db();
  const runs = conn2
    .prepare("SELECT COUNT(*) AS n FROM eval_runs WHERE artifact_id = ? AND against = '0.1.0'")
    .get(artifactId).n;
  const links = conn2
    .prepare(
      `SELECT COUNT(*) AS n FROM eval_batch_runs WHERE run_id NOT IN (SELECT id FROM eval_runs)`,
    )
    .get().n;
  conn2.close();
  assert.equal(runs, 0, "baseline version runs were deleted");
  assert.equal(links, 0, "no orphaned batch_runs");
});

test("after a purge recordRunOutputs writes no rows or files", async () => {
  const { srv, api, db } = await mk();
  await publish(api, "pid-outputs", "", "alice");
  const conn = db();
  const artifactId = conn
    .prepare("SELECT id FROM artifacts WHERE type='skill' AND name='pid-outputs'")
    .get().id;
  conn.close();

  const r = await api("POST", "/api/v1/artifacts/skill/pid-outputs/purge", {
    reason: "artifact contained a leaked secret",
    confirm: "skill/pid-outputs",
  }, "admin");
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const conn2 = db();
  const ids = recordRunOutputs(
    conn2,
    srv.dataDir,
    {
      runId: "eval:late",
      runKind: "eval",
      artifactId,
      version: "0.1.0",
      name: "late-case",
      actor: "alice",
    },
    {
      ok: true,
      code: 0,
      timedOut: false,
      outTruncated: false,
      errTruncated: false,
      stdout: "late output after purge",
      stderr: "",
      error: null,
      duration_ms: 5,
      workDir: undefined,
    },
  );
  assert.deepEqual(ids, [], "no records are created after a purge");
  const rows = conn2
    .prepare("SELECT COUNT(*) AS n FROM run_outputs WHERE artifact_id = ?")
    .get(artifactId).n;
  conn2.close();
  assert.equal(rows, 0, "no run_outputs rows");
  const outDir = join(srv.dataDir, "run-outputs");
  if (existsSync(outDir)) {
    const files = readdirSync(outDir, { recursive: true }).filter((f) =>
      typeof f === "string" ? true : f.isFile(),
    );
    assert.equal(files.length, 0, `run-outputs files did not remain: ${files}`);
  }
});

test("import run does not reveal the owner of someone else's team artifact", async () => {
  const { api } = await mk();
  assert.equal(
    (await api("POST", "/api/v1/teams", { name: "gamma", lead: "alice" })).status,
    201,
  );
  const pub = await api("POST", "/api/v1/artifacts", {
    type: "skill",
    visibility: "team",
    owner_team: "gamma",
    files: toB64([{ path: "pid-team/SKILL.md", content: skillMd("pid-team") }]),
  }, "alice");
  assert.equal(pub.status, 201, JSON.stringify(pub.data));

  const files = toB64([
    { path: "pid-team/SKILL.md", content: skillMd("pid-team", "<!-- bob edit -->\n") },
  ]);
  const preview = await api(
    "POST",
    "/api/v1/imports/preview",
    { source: { kind: "files", files } },
    "bob",
  );
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const cand = preview.data.candidates.find((c) => c.id === "skill/pid-team");
  assert.ok(cand, JSON.stringify(preview.data.candidates));

  const run = await api(
    "POST",
    "/api/v1/imports/run",
    { import_id: preview.data.import_id, selected: ["skill/pid-team"], skip_conflicts: true },
    "bob",
  );
  assert.equal(run.status, 200, JSON.stringify(run.data));
  const res = run.data.results[0];
  assert.ok(res, JSON.stringify(run.data));
  assert.equal(res.status, "skipped");
  assert.equal(res.reason, "not_owner");
  assert.equal(
    "owner" in res,
    false,
    `the team artifact owner must not be revealed to an outsider: ${JSON.stringify(res)}`,
  );
});
