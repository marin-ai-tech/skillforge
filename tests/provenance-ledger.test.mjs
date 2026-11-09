// Acceptance tests for the provenance ledger. Requires `npm run build`.
// Append-only provenance ledger: publish/import/eval/workflow write records,
// GET/POST /artifacts/:type/:name/provenance, derive, purge, DB triggers.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  startServer,
  api as rawApi,
  login,
  createUser,
  toB64,
  ROOT,
  ADMIN_PASSWORD,
} from "./lib/client.mjs";

const RUNNER = join(ROOT, "tests", "fixtures", "eval-runners", "mock-runner.mjs");
const MIGRATION = join(ROOT, "packages", "server", "migrations", "0026_provenance_ledger.sql");
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
          /* the temp directory stays in %TEMP% — not a product defect */
        }
      } else throw e;
    }
  }
});

const skillMd = (name) =>
  `---\nname: ${name}\ndescription: Provenance test skill\n---\n\n# ${name}\n\nANSWER: good-answer\n`;
const step = (id, code) => ({ id, kind: "command", argv: [process.execPath, "-e", code] });
const until = async (fn, { timeout = 60000, step: st = 200 } = {}) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, st));
  }
};

async function mk() {
  const work = mkdtempSync(join(tmpdir(), "skillforge-pl-work-"));
  const runnersFile = join(work, "runners.json");
  writeFileSync(
    runnersFile,
    JSON.stringify({
      runners: [
        { id: "mock-a", label: "mock-a", command: [process.execPath, RUNNER], timeout_s: 5 },
      ],
    }),
  );
  const srv = await startServer(
    { SKILLFORGE_EVAL_RUNNERS_FILE: runnersFile, SKILLFORGE_ORCHESTRATION_ENABLED: "true" },
    { prefix: "skillforge-pl-" },
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
  const api = (method, path, body, who = "admin") =>
    rawApi(srv.base, method, path, body, who === "anon" ? {} : { cookie: U[who].cookie });
  const A = (n, t = "skill") => `/api/v1/artifacts/${t}/${n}`;
  return {
    srv,
    api,
    A,
    publish: async (name, version = "0.1.0", provenance) => {
      const body = {
        type: "skill",
        name,
        version,
        files: toB64([
          { path: `${name}/SKILL.md`, content: Buffer.from(`${skillMd(name)}\n<!-- v${version} -->\n`) },
        ]),
      };
      if (provenance) body.provenance = provenance;
      const r = await api("POST", "/api/v1/artifacts", body);
      assert.equal(r.status, 201, `publish ${name}: ${JSON.stringify(r.data)}`);
    },
    ledger: (name, qs = "", who = "admin") =>
      api("GET", `${A(name)}/provenance${qs}`, undefined, who),
    derive: (name, body, who = "rita") => api("POST", `${A(name)}/provenance`, body, who),
    dbRows: (name) => {
      const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true });
      const rows = db
        .prepare(
          `SELECT p.* FROM provenance_ledger p JOIN artifacts a ON a.id = p.artifact_id
           WHERE a.name = ? ORDER BY p.id`,
        )
        .all(name);
      db.close();
      return rows;
    },
  };
}

test("publish writes kind=publish with the version provenance; GET returns the newest first", async () => {
  const h = await mk();
  await h.publish("pl-pub", "0.1.0", { source: "agent", ref: "run-9" });
  await h.publish("pl-pub", "0.2.0", { source: "import", ref: "https://src/x" });

  const r = await h.ledger("pl-pub");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const items = r.data.items;
  assert.ok(items.length >= 2, `expected ≥2 records: ${JSON.stringify(items)}`);
  const v02 = items.find((e) => e.version === "0.2.0");
  const v01 = items.find((e) => e.version === "0.1.0");
  assert.equal(v01.kind, "publish");
  assert.equal(v01.source, "agent");
  assert.equal(v01.ref, "run-9");
  assert.equal(v02.kind, "import");
  assert.equal(v02.source, "import");
  // newest first
  assert.ok(
    items.indexOf(v02) < items.indexOf(v01),
    "order: newest first",
  );
  // filters
  const only01 = await h.ledger("pl-pub", "?version=0.1.0");
  assert.ok(only01.data.items.every((e) => e.version === "0.1.0"));
  const onlyImport = await h.ledger("pl-pub", "?kind=import");
  assert.ok(onlyImport.data.items.every((e) => e.kind === "import"));
});

test("an eval run writes kind=eval, a workflow writes kind=workflow", async () => {
  const h = await mk();
  await h.publish("pl-ev");
  const suite = await h.api("PUT", `${h.A("pl-ev")}/evals`, {
    cases: [{ id: "t1", kind: "task", prompt: "solve", checks: [{ type: "contains", value: "good-answer" }] }],
  });
  assert.equal(suite.status, 200);
  const b = await h.api("POST", `${h.A("pl-ev")}/evals/batches`, {
    kind: "ablation",
    version: "0.1.0",
    runners: ["mock-a"],
  });
  assert.equal(b.status, 202, JSON.stringify(b.data));
  const bid = b.data.batch.id;
  const done = await until(async () => {
    const g = await h.api("GET", `${h.A("pl-ev")}/evals/batches/${bid}`);
    return g.data?.batch?.status === "done" ? g.data.batch : null;
  });
  assert.ok(done, "ablation batch finished");
  const evalRows = h.dbRows("pl-ev").filter((e) => e.kind === "eval");
  assert.ok(evalRows.length >= 1, "eval record in the ledger");
  assert.match(evalRows[0].ref, /^eval_run:\d+$/);

  // workflow
  const wf = await h.api("PUT", `${h.A("pl-ev")}/workflows/pipe`, {
    definition: { version: 1, steps: [step("one", "console.log('x')")] },
  });
  assert.equal(wf.status, 200, JSON.stringify(wf.data));
  const run = await h.api("POST", `${h.A("pl-ev")}/workflows/pipe/runs`, {});
  assert.equal(run.status, 202, JSON.stringify(run.data));
  await until(async () => {
    const g = await h.api("GET", `${h.A("pl-ev")}/workflows/runs/${run.data.run.id}`);
    return g.data?.run?.status === "done" ? g.data.run : null;
  });
  const wfRows = h.dbRows("pl-ev").filter((e) => e.kind === "workflow");
  assert.ok(wfRows.length >= 1, "workflow record in the ledger");
  assert.match(wfRows[0].ref, /^workflow_run:\d+$/);
});

test("derive: POST writes parent; ACL 401/403/404/422", async () => {
  const h = await mk();
  await h.publish("pl-base");
  await h.publish("pl-child");
  const r = await h.derive("pl-child", {
    kind: "derive",
    parent: { type: "skill", name: "pl-base", version: "0.1.0" },
    transform: "fork",
    ref: "decision-42",
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const row = h.dbRows("pl-child").find((e) => e.kind === "derive");
  assert.ok(row, "derive record");
  assert.equal(row.transform, "fork");
  assert.ok(row.parent_artifact_id, "parent_artifact_id is filled");
  assert.equal(row.parent_version, "0.1.0");

  // ACL
  assert.equal(
    (await h.derive("pl-child", { kind: "derive", parent: { type: "skill", name: "pl-base" } }, "anon")).status,
    401,
  );
  assert.equal(
    (await h.derive("pl-child", { kind: "derive", parent: { type: "skill", name: "pl-base" } }, "vera")).status,
    403,
  );
  // nonexistent parent → 404
  const ghost = await h.derive("pl-child", {
    kind: "derive",
    parent: { type: "skill", name: "no-such", version: "0.1.0" },
  });
  assert.equal(ghost.status, 404);
  // different kind → 422
  const bad = await h.derive("pl-child", { kind: "eval", ref: "x" });
  assert.equal(bad.status, 422);
  // publishing itself produces a record — GET is public (like audit): a visible artifact is readable
  const pub = await h.ledger("pl-child", "", "anon");
  assert.equal(pub.status, 200, "an org artifact is readable anonymously, like audit");
});

test("append-only: UPDATE and DELETE are rejected by DB triggers", async () => {
  // checking the triggers on an isolated DB with the migration applied
  const dir = mkdtempSync(join(tmpdir(), "skillforge-pl-db-"));
  const db = new DatabaseSync(join(dir, "t.db"));
  db.exec(readFileSync(MIGRATION, "utf8"));
  db.exec(
    `CREATE TABLE artifacts (id TEXT PRIMARY KEY, type TEXT, name TEXT);`,
  );
  db.prepare(
    `INSERT INTO artifacts (id, type, name) VALUES ('a1','skill','x')`,
  ).run();
  // FK may be off — insert directly
  try {
    db.prepare(`DELETE FROM provenance_ledger`).run();
  } catch {
    /* no rows — ok */
  }
  db.prepare(
    `INSERT INTO provenance_ledger (artifact_id, kind, source, ts) VALUES ('a1','publish','human','t')`,
  ).run();
  assert.throws(() => db.prepare(`UPDATE provenance_ledger SET source='x'`).run(), /append-only/i);
  assert.throws(() => db.prepare(`DELETE FROM provenance_ledger`).run(), /append-only/i);
  const n = db.prepare(`SELECT COUNT(*) n FROM provenance_ledger`).get().n;
  assert.equal(n, 1);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("purge: ledger records are deleted, the trigger is restored", async () => {
  const h = await mk();
  await h.publish("pl-purge");
  assert.ok(h.dbRows("pl-purge").length >= 1, "a publish record exists");
  // purge of the artifact (admin)
  const p = await h.api("POST", `${h.A("pl-purge")}/purge`, {
    confirm: "skill/pl-purge",
    reason: "provenance test cleanup",
  });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(h.dbRows("pl-purge").length, 0, "ledger cleared");
  // the trigger is alive: it is row-level, so first publish another artifact (a row appears),
  // then a direct DELETE/UPDATE is rejected
  await h.publish("pl-purge2");
  const db = new DatabaseSync(join(h.srv.dataDir, "skillforge.db"));
  try {
    db.prepare(`DELETE FROM provenance_ledger`).run();
    assert.fail("DELETE must be rejected by the trigger");
  } catch (e) {
    assert.match(String(e.message), /append-only/i);
  } finally {
    db.close();
  }
});
