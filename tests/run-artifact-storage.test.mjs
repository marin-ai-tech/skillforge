// Acceptance tests: run artifact storage.
// Run output index `run_outputs`, dedicated
// content-addressed store `data/run-outputs/<aa>/<sha256>`, eraser in the purge registry,
// read-only API `.../run-outputs` and CLI `skillforge runs list|show`.
// Static source analysis only: no server, no network, no new dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const has = (rel) => existsSync(join(ROOT, rel));

const MIGRATIONS = "packages/server/migrations";
const REGISTRY = "packages/server/src/purge/erasers.ts";
const ROUTE = "packages/server/src/routes/run-outputs.ts";
const APP = "packages/server/src/app.ts";
const STORE = "packages/server/src/runs/outputs.ts";
const CLI_INDEX = "packages/cli/src/index.ts";
const CLI_CMD = "packages/cli/src/commands/runs.ts";

/** All .ts files under packages/server/src (for registerEraser calls outside the registry). */
function serverSources(dir = "packages/server/src") {
  const out = [];
  for (const n of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${n}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...serverSources(rel));
    else if (n.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/** Object literal (balanced braces) that contains `table: "<name>"`, or null. */
function entryFor(src, table) {
  const at = src.search(new RegExp(`table:\\s*["']${table}["']`));
  if (at < 0) return null;
  let start = at;
  for (let depth = 0; start > 0; start--) {
    const c = src[start];
    if (c === "}") depth++;
    if (c === "{") {
      if (depth === 0) break;
      depth--;
    }
  }
  let end = at;
  for (let depth = 0; end < src.length; end++) {
    const c = src[end];
    if (c === "{") depth++;
    if (c === "}") {
      if (depth === 0) break;
      depth--;
    }
  }
  return src.slice(start, end + 1);
}

test("migration declares the run_outputs index table with the planned columns", () => {
  const files = readdirSync(join(ROOT, MIGRATIONS)).filter((n) => n.endsWith(".sql"));
  let body = null;
  let origin = null;
  for (const f of files) {
    const m = read(`${MIGRATIONS}/${f}`).match(
      /CREATE TABLE(?: IF NOT EXISTS)?\s+"?run_outputs"?\s*\(([\s\S]*?)\n\);/i,
    );
    if (m) {
      body = m[1];
      origin = f;
    }
  }
  assert.ok(body, `no migration in ${MIGRATIONS} creates table run_outputs`);
  const cols = body
    .split("\n")
    .map((l) => l.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+[A-Z]/i)?.[1]?.toLowerCase())
    .filter(Boolean);
  for (const c of ["artifact_id", "version", "run_id", "run_kind", "stream", "sha256", "size", "exit_code", "created_by", "created_at"])
    assert.ok(cols.includes(c), `run_outputs (${origin}) lacks column ${c}`);
});

test("purge eraser for run_outputs is registered (delete, artifact + version scopes)", () => {
  let entry = has(REGISTRY) ? entryFor(read(REGISTRY), "run_outputs") : null;
  let where = REGISTRY;
  if (!entry) {
    for (const rel of serverSources()) {
      const src = read(rel);
      if (!/registerEraser\s*\(/.test(src)) continue;
      const e = entryFor(src, "run_outputs");
      if (e) {
        entry = e;
        where = rel;
        break;
      }
    }
  }
  assert.ok(entry, `no purge eraser with table: "run_outputs" in ${REGISTRY} or a registerEraser() call`);
  assert.match(entry, /strategy:\s*["']delete["']/, `run_outputs eraser in ${where} must use strategy "delete"`);
  assert.match(entry, /scopes:\s*\[\s*["']artifact["']\s*,\s*["']version["']\s*\]/, `run_outputs eraser in ${where} must cover the version scope`);
  assert.match(entry, /\b(erase|sql)\s*[:,}]/, `run_outputs eraser in ${where} needs erase or sql`);
});

test("read-only API run-outputs is wired with visibility/role gate and safe content headers", () => {
  assert.ok(has(ROUTE), `missing ${ROUTE}`);
  const src = read(ROUTE);
  assert.match(src, /export const runOutputsRoutes\b|export (async )?function runOutputsRoutes\b/, "route module must export runOutputsRoutes");
  assert.match(src, /["'`]\/api\/v1\/artifacts\/:type\/:name\/run-outputs["'`]/, "list endpoint missing");
  assert.match(src, /["'`]\/api\/v1\/artifacts\/:type\/:name\/run-outputs\/:id\/content["'`]/, "content endpoint missing");
  assert.doesNotMatch(src, /app\.(post|put|patch|delete)\b/, "v1 run-outputs API must be read-only");
  assert.match(src, /canManageEvals|canPublishVersion/, "run outputs must be gated by canManageEvals/canPublishVersion");
  assert.match(src, /nosniff/i, "content endpoint must send X-Content-Type-Options: nosniff");
  assert.match(src, /output_gone/, "missing blob must map to 410 output_gone");
  const app = read(APP);
  assert.match(app, /import\s*\{\s*runOutputsRoutes\s*\}\s*from\s*["']\.\/routes\/run-outputs\.ts["']/, "app.ts must import runOutputsRoutes");
  assert.match(app, /app\.register\(\s*runOutputsRoutes\b/, "app.ts must register runOutputsRoutes");
});

test("CLI exposes skillforge runs list|show", () => {
  assert.ok(has(CLI_CMD), `missing ${CLI_CMD}`);
  const idx = read(CLI_INDEX);
  assert.match(idx, /\.command\(\s*["']runs["']\s*\)/, "CLI index.ts must define the runs command group");
  assert.match(idx, /from\s*["']\.\/commands\/runs\.ts["']/, "CLI index.ts must import ./commands/runs.ts");
  const cmd = read(CLI_CMD);
  assert.match(cmd, /\/run-outputs/, "runs command must call the run-outputs API");
  assert.match(cmd, /\/content/, "runs show --raw must read the content endpoint");
});

test("run output content uses a dedicated store, not the artifact blob store", () => {
  assert.ok(has(STORE), `missing ${STORE}`);
  const src = read(STORE);
  assert.match(src, /["'`]run-outputs["'`]/, `${STORE} must store content under data/run-outputs`);
  assert.doesNotMatch(src, /\bblobPath\s*\(|\bputBlob\s*\(/, `${STORE} must not write into the shared data/blobs store`);
  assert.match(src, /export function recordRunOutputs\b/, `${STORE} must export recordRunOutputs()`);
  assert.match(src, /outTruncated|errTruncated/, "recordRunOutputs must map SpawnIsolatedResult truncation flags");
});
