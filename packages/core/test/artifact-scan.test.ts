import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanImportTree } from "../src/artifact/scan.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const SAMPLE = join(ROOT, "tests", "fixtures", "imports", "plugin-sample");

function loadDir(dir: string): Array<{ path: string; content: Uint8Array }> {
  const out: Array<{ path: string; content: Uint8Array }> = [];
  function walk(d: string) {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const rel = relative(dir, full).split("\\").join("/");
        out.push({ path: rel, content: new Uint8Array(readFileSync(full)) });
      }
    }
  }
  walk(dir);
  return out;
}

test("scanImportTree: plugin-sample yields 5 candidates, reckon, hook name, skipped", () => {
  const files = loadDir(SAMPLE);
  const result = scanImportTree(files);
  const ids = result.candidates.map((c) => c.id).sort();
  assert.deepEqual(ids, [
    "agent/reviewer-bot",
    "command/deploy",
    "hook/ops-plugin",
    "skill/csv-tools",
    "skill/power-grid",
  ]);

  const grid = result.candidates.find((c) => c.id === "skill/power-grid");
  assert.ok(grid);
  assert.deepEqual(grid.provenance, {
    source: "reckon",
    ref: ".reckon/skills/power-grid.md",
  });

  const hook = result.candidates.find((c) => c.id === "hook/ops-plugin");
  assert.ok(hook);
  assert.equal(hook.nameHint, "ops-plugin");
  assert.deepEqual(hook.files.map((f) => f.path).sort(), ["hooks/hooks.json", "scripts/guard.sh"]);

  const csv = result.candidates.find((c) => c.id === "skill/csv-tools");
  assert.ok(csv);
  assert.equal(csv.files.length, 2);
  assert.equal(csv.nameHint, "csv-tools");

  assert.ok(result.skipped.some((s) => s.path.endsWith("node_modules/junk/index.js")));
  assert.ok(result.skipped.some((s) => s.path.endsWith(".claude-plugin/plugin.json")));

  const claimed = new Set<string>();
  for (const c of result.candidates) {
    for (const f of c.files) {
      const abs = c.root ? `${c.root}/${f.path}` : f.path;
      assert.ok(!claimed.has(abs), `file claimed twice: ${abs}`);
      claimed.add(abs);
    }
  }
});
