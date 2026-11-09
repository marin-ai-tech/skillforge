// Acceptance tests: the `purge` audit event is append-only.
// Blob deletion counters are written as a separate `purge_blobs` event, not by UPDATEing the `purge` record.
// The oracle is a SQLite trigger that forbids UPDATE of rows with action = 'purge' (redaction of other events during purge
// does not touch purge rows and remains allowed).
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startServer, api, login, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let admin;
const md = (v) => `---\nname: pa-skill\ndescription: Purge audit probe ${v}\n---\n\n# pa-skill ${v}\n`;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-purge-audit-" });
  assert.ok(srv.up, srv.stderr);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const v of ["0.1.0", "0.2.0"]) {
    const r = await api(srv.base, "POST", "/api/v1/artifacts", { type: "skill", version: v, files: toB64([{ path: "pa-skill/SKILL.md", content: md(v) }]) }, admin);
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"));
  try {
    db.exec(`CREATE TRIGGER test_purge_audit_append_only BEFORE UPDATE ON audit_events WHEN OLD.action = 'purge'
             BEGIN SELECT RAISE(ABORT, 'purge audit event is append-only'); END;`);
  } finally {
    db.close();
  }
});

after(async () => {
  try {
    await srv?.stop?.();
  } catch {
    try {
      rmSync(srv.dataDir, { recursive: true, force: true });
    } catch {
      /* Windows EPERM */
    }
  }
});

test("version purge: the purge event is not rewritten, blob counters go in a separate purge_blobs event", { timeout: 60_000 }, async () => {
  const r = await api(srv.base, "POST", "/api/v1/artifacts/skill/pa-skill/versions/0.1.0/purge", {
    reason: "append-only audit acceptance check",
    confirm: "skill/pa-skill@0.1.0",
  }, admin);
  assert.equal(r.status, 200, `purge failed (UPDATE of the purge event?): ${r.status} ${JSON.stringify(r.data)}`);
  assert.equal(typeof r.data.blobs_deleted, "number", "the purge response still contains the counters");

  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT id, action, meta FROM audit_events WHERE action IN ('purge', 'purge_blobs') ORDER BY id")
      .all()
      .map((x) => ({ ...x, meta: x.meta ? JSON.parse(x.meta) : null }));
    const purge = rows.filter((x) => x.action === "purge");
    const blobs = rows.filter((x) => x.action === "purge_blobs");
    assert.equal(purge.length, 1, JSON.stringify(rows));
    assert.equal(blobs.length, 1, `no purge_blobs event: ${JSON.stringify(rows)}`);
    assert.ok(blobs[0].id > purge[0].id, "purge_blobs comes after purge");
    assert.equal(blobs[0].meta.version, "0.1.0");
    assert.equal(blobs[0].meta.blobs_deleted, r.data.blobs_deleted, "event counters match the response");
  } finally {
    db.close();
  }
});
