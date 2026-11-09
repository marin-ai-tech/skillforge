// The rule for which files of an agent directory go into the snapshot.
// The oracle is the server scanner itself: exactly what `scanImportTree` classifies as artifacts is sent, plus
// `.claude-plugin/plugin.json` of hook-set roots (the name is taken from it). Shared fixture with the web rule:
// tests/fixtures/agents/with-secrets(.expected.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { scanImportTree } from "../src/artifact/scan.ts";
import { artifactUploadPaths } from "../src/artifact/upload-paths.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURE = join(ROOT, "tests", "fixtures", "agents", "with-secrets");
const EXPECTED = JSON.parse(
  readFileSync(join(ROOT, "tests", "fixtures", "agents", "with-secrets.expected.json"), "utf8"),
) as { upload: string[]; not_sent: string[] };

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(abs));
    else out.push(relative(FIXTURE, abs).split(sep).join("/"));
  }
  return out;
}

const PATHS = listFiles(FIXTURE);

test("with-secrets fixture: the expected list is sent, the rest is not_sent", () => {
  const r = artifactUploadPaths(PATHS);
  assert.deepEqual([...r.upload].sort(), [...EXPECTED.upload].sort());
  assert.deepEqual([...r.notSent].sort(), [...EXPECTED.not_sent].sort());
});

test("oracle: the rule matches the server scanner", () => {
  const scanned = scanImportTree(PATHS.map((p) => ({ path: p, content: "" })));
  const skipped = new Set(scanned.skipped.map((s) => s.path));
  const hookManifests = scanned.candidates
    .filter((c) => c.type === "hook")
    .map((c) => (c.root ? `${c.root}/.claude-plugin/plugin.json` : ".claude-plugin/plugin.json"))
    .filter((p) => PATHS.includes(p));
  const oracle = new Set([...PATHS.filter((p) => !skipped.has(p)), ...hookManifests]);
  assert.deepEqual([...artifactUploadPaths(PATHS).upload].sort(), [...oracle].sort());
});

test("node_modules, .git and dist are not sent even inside a skill directory", () => {
  const r = artifactUploadPaths([
    "skills/a/SKILL.md",
    "skills/a/node_modules/x/index.js",
    "skills/a/.git/config",
    "skills/a/dist/out.js",
  ]);
  assert.deepEqual(r.upload, ["skills/a/SKILL.md"]);
});

test("SKILL.md at the directory root: only it is sent", () => {
  const r = artifactUploadPaths(["SKILL.md", "settings.local.json", "notes.txt"]);
  assert.deepEqual(r.upload, ["SKILL.md"]);
  assert.deepEqual([...r.notSent].sort(), ["notes.txt", "settings.local.json"]);
});
