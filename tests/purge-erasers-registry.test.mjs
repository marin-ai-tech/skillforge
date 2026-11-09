// Acceptance tests: purge erasers registry.
// Every table with an `artifact_id` column (or a plugin table keyed by
// artifact_type/artifact_name) MUST be registered in the purge eraser registry. The
// cascade of `session_facts` / `artifact_usage_reports` is declared and documented in help.
// Static source analysis only: no server, no network, no new dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const REGISTRY_CANDIDATES = [
  "packages/server/src/purge/erasers.ts",
  "packages/server/src/purge/registry.ts",
  "packages/server/src/purge-erasers.ts",
];
const PURGE_ROUTE = "packages/server/src/routes/metadata-purge.ts";
const PURGE_HELP = "packages/web/src/help/topics/getting-started/purge.md";
const STRATEGIES = ["delete", "redact", "tombstone", "keep"];

function findRegistry() {
  for (const rel of REGISTRY_CANDIDATES) {
    if (existsSync(join(ROOT, rel))) return { rel, src: read(rel) };
  }
  return null;
}

/** Columns of a CREATE TABLE body (first identifier of each line). */
function columnsOf(body) {
  return body
    .split("\n")
    .map((l) => l.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+[A-Z]/i)?.[1])
    .filter(Boolean)
    .map((c) => c.toLowerCase());
}

/**
 * Tables that hold per-artifact data, derived from the schema itself so the test stays
 * discriminating when a new migration or plugin adds such a table.
 */
function artifactTables() {
  const tables = new Map();
  const add = (name, origin) => {
    if (name !== "artifacts" && !tables.has(name)) tables.set(name, origin);
  };
  const migDir = join(ROOT, "packages", "server", "migrations");
  for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql"))) {
    const sql = read(`packages/server/migrations/${f}`);
    for (const m of sql.matchAll(
      /CREATE TABLE(?: IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi,
    )) {
      if (columnsOf(m[2]).includes("artifact_id")) add(m[1].toLowerCase(), f);
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+"?artifact_id"?\b/gi)) {
      add(m[1].toLowerCase(), f);
    }
  }
  const pluginsDir = join(ROOT, "plugins");
  for (const p of existsSync(pluginsDir) ? readdirSync(pluginsDir) : []) {
    for (const file of ["index.js", "index.mjs"]) {
      const rel = `plugins/${p}/${file}`;
      if (!existsSync(join(ROOT, rel))) continue;
      const src = read(rel);
      for (const m of src.matchAll(
        /CREATE TABLE(?: IF NOT EXISTS)?\s+"?(\w+)"?\s*\(([\s\S]*?)\)\s*[`"']/gi,
      )) {
        const cols = columnsOf(m[2]);
        if (
          cols.includes("artifact_id") ||
          (cols.includes("artifact_type") && cols.includes("artifact_name"))
        )
          add(m[1].toLowerCase(), rel);
      }
    }
  }
  return tables;
}

/** Registry entries: one object literal per table, split at each `table: "<name>"`. */
function registryEntries(src) {
  const hits = [...src.matchAll(/\btable\s*:\s*["'`](\w+)["'`]/g)];
  return hits.map((m, i) => ({
    table: m[1].toLowerCase(),
    body: src.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : src.length),
  }));
}

function isDefinedOrImported(src, name) {
  const id = name.replace(/[$]/g, "\\$");
  return (
    new RegExp(`\\bfunction\\s+${id}\\s*\\(`).test(src) ||
    new RegExp(`\\b(?:const|let)\\s+${id}\\s*=`).test(src) ||
    new RegExp(`import\\s*\\{[^}]*\\b${id}\\b[^}]*\\}\\s*from`).test(src)
  );
}

test("purge eraser registry module exists and exports PURGE_ERASERS and registerEraser", () => {
  const reg = findRegistry();
  assert.ok(
    reg,
    `missing purge eraser registry module (expected one of: ${REGISTRY_CANDIDATES.join(", ")})`,
  );
  assert.match(
    reg.src,
    /export\s+(?:const|let)\s+PURGE_ERASERS\b|export\s*\{[^}]*\bPURGE_ERASERS\b/,
    `${reg.rel} must export PURGE_ERASERS (built-in eraser list)`,
  );
  assert.match(
    reg.src,
    /export\s+function\s+registerEraser\s*\(|export\s*\{[^}]*\bregisterEraser\b/,
    `${reg.rel} must export registerEraser() for subsystems registering at startup`,
  );
});

test("every table with artifact_id (or plugin artifact_type/artifact_name) is registered", () => {
  const tables = artifactTables();
  // Sanity: the derivation must see the known per-artifact tables, otherwise the test is vacuous.
  for (const known of [
    "artifact_versions",
    "audit_events",
    "comments",
    "notifications",
    "session_facts",
    "artifact_usage_reports",
    "eval_runs",
    "ext_review_assistant_runs",
  ]) {
    assert.ok(tables.has(known), `schema derivation did not find table ${known}`);
  }
  const reg = findRegistry();
  assert.ok(reg, "missing purge eraser registry module");
  const registered = new Set(registryEntries(reg.src).map((e) => e.table));
  const missing = [...tables.keys()].filter((t) => !registered.has(t)).sort();
  assert.deepEqual(
    missing,
    [],
    `tables with artifact_id/version not registered in ${reg.rel}: ${missing
      .map((t) => `${t} (${tables.get(t)})`)
      .join(", ")}`,
  );
});

test("each registry entry declares a strategy and maps to a known erase function or SQL", () => {
  const reg = findRegistry();
  assert.ok(reg, "missing purge eraser registry module");
  const entries = registryEntries(reg.src);
  assert.ok(entries.length > 0, `${reg.rel} has no { table: "..." } entries`);
  const seen = new Set();
  const bad = [];
  for (const { table, body } of entries) {
    if (seen.has(table)) bad.push(`${table}: registered twice`);
    seen.add(table);
    const strategy = body.match(/\bstrategy\s*:\s*["'](\w+)["']/)?.[1];
    if (!strategy || !STRATEGIES.includes(strategy)) {
      bad.push(`${table}: strategy must be one of ${STRATEGIES.join("|")} (got ${strategy})`);
      continue;
    }
    if (strategy === "keep") {
      if (!/\breason\s*:\s*["'`][^"'`]{10,}/.test(body))
        bad.push(`${table}: strategy "keep" requires a reason of at least 10 characters`);
      continue;
    }
    const fn = body.match(/\berase\s*:\s*([A-Za-z_$][\w$]*)/)?.[1];
    const sql = new RegExp(`\\bsql\\s*:[\\s\\S]*?\\b(?:DELETE\\s+FROM|UPDATE)\\s+"?${table}\\b`, "i");
    if (fn && isDefinedOrImported(reg.src, fn)) continue;
    if (sql.test(body)) continue;
    bad.push(
      `${table}: needs erase: <function defined or imported in ${reg.rel}> or sql: "DELETE FROM/UPDATE ${table} ..."`,
    );
  }
  assert.deepEqual(bad, []);
});

test("purge route runs erasers through the registry, not hand-written per-table deletes", () => {
  const reg = findRegistry();
  assert.ok(reg, "missing purge eraser registry module");
  const route = read(PURGE_ROUTE);
  const modPath = reg.rel.replace(/^packages\/server\/src\//, "").replace(/\.ts$/, "");
  assert.match(
    route,
    new RegExp(`from\\s+["'][./]*${modPath.replace(/\//g, "\\/")}(?:\\.ts)?["']`),
    `${PURGE_ROUTE} must import the eraser registry (${reg.rel})`,
  );
  const inline = [
    ...route.matchAll(
      /DELETE FROM\s+(comments|notifications|session_facts|artifact_usage_reports|eval_\w+|ext_review_assistant_\w+)\b/g,
    ),
  ].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(inline)],
    [],
    `${PURGE_ROUTE} still erases tables by hand; move these into the registry`,
  );
});

test("cascade of session_facts / artifact_usage_reports is declared and documented", () => {
  const reg = findRegistry();
  assert.ok(reg, "missing purge eraser registry module");
  const entries = new Map(registryEntries(reg.src).map((e) => [e.table, e.body]));
  for (const t of ["session_facts", "artifact_usage_reports"]) {
    assert.ok(entries.has(t), `${t} must be registered`);
    assert.match(entries.get(t), /\bcascade\s*:/, `${t} entry must declare cascade`);
    assert.match(
      entries.get(t),
      /\bscopes?\s*:[^\n]*["']version["']/,
      `${t} entry must apply to version purge (scope "version")`,
    );
  }
  const help = read(PURGE_HELP);
  assert.match(help, /metric/i, `${PURGE_HELP} must explain the effect on usage metrics`);
  assert.match(
    help,
    /lifecycle/i,
    `${PURGE_HELP} must explain the effect on lifecycle activity signals`,
  );
});
