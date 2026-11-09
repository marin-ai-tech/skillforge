// Acceptance tests: uploading an agent folder in the web UI sends only artifact files. The web rule must match the core rule
// on the shared fixture tests/fixtures/agents/with-secrets(.expected.json); the core is checked against the server scanner in packages/core/test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { agentUploadPaths } from "../src/lib/agent-files.ts";

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

test("with-secrets fixture: the web sends the same list as the core", () => {
  const r = agentUploadPaths(listFiles(FIXTURE));
  assert.deepEqual([...r.upload].sort(), [...EXPECTED.upload].sort());
  assert.deepEqual([...r.notSent].sort(), [...EXPECTED.not_sent].sort());
});

test("commands and subagents in client directories; Reckon; SKILL.md at the root", () => {
  const r = agentUploadPaths([
    ".codex/agents/reviewer.toml",
    ".cursor/commands/ship.md",
    "agent/helper.md",
    ".reckon/skills/flaky-tests.md",
    ".codex/config.toml",
    ".codex/auth.json",
    "commands/nested/deep.md",
  ]);
  assert.deepEqual([...r.upload].sort(), [
    ".codex/agents/reviewer.toml",
    ".cursor/commands/ship.md",
    ".reckon/skills/flaky-tests.md",
    "agent/helper.md",
  ]);
  assert.deepEqual([...r.notSent].sort(), [
    ".codex/auth.json",
    ".codex/config.toml",
    "commands/nested/deep.md",
  ]);
});
