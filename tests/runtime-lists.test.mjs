// Hygiene test: the agent snapshot runtime list comes only from the core
// (`IMPORT_RUNTIMES`) or from `GET /api/v1/runtimes`. Previously `["claude-code", "reckon", "generic"]` was copied in
// four places and fell behind the runtime table (Codex, Cursor, OpenCode, Qwen Code were not accepted).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const FILES = [
  "packages/server/src/routes/agents.ts",
  "packages/server/src/routes/admin-agents.ts",
  "packages/web/src/pages/me/Agents.tsx",
  "packages/web/src/pages/admin/Agents.tsx",
];

test("no literal runtime lists in agent routes and pages", () => {
  const bad = [];
  for (const rel of FILES) {
    const text = readFileSync(join(ROOT, ...rel.split("/")), "utf8");
    for (const id of ["reckon", "codex", "opencode", "cursor", "qwen", "gemini", "devin"]) {
      if (new RegExp(`["'\`]${id}["'\`]`).test(text)) bad.push(`${rel}: literal "${id}"`);
    }
  }
  assert.deepEqual(bad, []);
});
