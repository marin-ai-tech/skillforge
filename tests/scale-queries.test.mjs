// Acceptance tests: the metrics summary does not substitute the identifiers of all
// artifacts into `IN (?, …)` — on a registry larger than the SQLite parameter limit (32 766) it must work and count correctly.
// Requires `npm run build`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/client.mjs";

const dist = (p) => pathToFileURL(join(ROOT, "packages", "server", "dist", p)).href;
const dataDir = mkdtempSync(join(tmpdir(), "skillforge-scale-"));
let db;
after(() => {
  try {
    db?.close();
  } catch {
    /* already closed */
  }
  rmSync(dataDir, { recursive: true, force: true });
});

const N = 33_000; // above SQLITE_MAX_VARIABLE_NUMBER (32 766)

test(`metricsOverview on ${N} visible artifacts: no SQLite error, the totals are correct`, { timeout: 120_000 }, async () => {
  const { openDatabase, migrate } = await import(dist("db.js"));
  const { metricsOverview, parseMetricsQuery } = await import(dist("metrics/overview.js"));
  db = openDatabase(dataDir);
  migrate(db);

  const now = new Date().toISOString();
  const insA = db.prepare(
    `INSERT INTO artifacts (id, type, name, description, tags, status, created_by, created_at, updated_at, owner)
     VALUES (?, 'skill', ?, 'scale probe', '[]', 'active', 'admin', ?, ?, 'admin')`,
  );
  db.exec("BEGIN");
  for (let i = 0; i < N; i++) insA.run(`scale-${i}`, `scale-skill-${i}`, now, now);
  // One artifact with a version and counters — a check that the aggregates were not lost.
  db.prepare(
    `INSERT INTO artifact_versions (id, artifact_id, version, digest, description, tags, files, warnings, model_compat,
       provenance, evidence, use_count, help_count, published_by, published_at)
     VALUES ('v-0', 'scale-0', '0.1.0', 'sha256:0', 'scale probe', '[]', '[]', '[]', '[]', '{}', '[]', 3, 1, 'admin', ?)`,
  ).run(now);
  db.prepare("UPDATE artifacts SET latest_version = '0.1.0' WHERE id = 'scale-0'").run();
  db.exec("COMMIT");

  const parsed = parseMetricsQuery({});
  assert.equal(parsed.ok, true);
  let overview;
  assert.doesNotThrow(() => {
    overview = metricsOverview(db, { username: "admin", role: "admin" }, parsed.query);
  }, "metricsOverview failed on a large registry (SQLite parameter limit)");
  assert.equal(overview.totals.artifacts, N);
  assert.equal(overview.totals.uses, 3);
  assert.equal(overview.totals.helped, 1);
  const probe = overview.items.find((r) => r.name === "scale-skill-0");
  if (probe) assert.equal(probe.uses, 3);
});
