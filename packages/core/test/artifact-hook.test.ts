import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArtifact } from "../src/artifact/index.ts";
import { ISSUE_CODES } from "../src/artifact/types.ts";

test("hook: guard fixture", () => {
  const files = [
    { path: "hooks.json", content: readFileSync("test/fixtures/hook-guard/hooks.json") },
    {
      path: "scripts/guard.sh",
      content: readFileSync("test/fixtures/hook-guard/scripts/guard.sh"),
    },
    { path: "README.md", content: readFileSync("test/fixtures/hook-guard/README.md") },
  ];
  const r = parseArtifact({ type: "hook", files, name: "destructive-guard" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.artifact.name, "destructive-guard");
  assert.match(r.artifact.description, /^Asks for confirmation/);
  assert.deepEqual(
    r.artifact.files.map((f) => f.path),
    ["README.md", "hooks/hooks.json", "scripts/guard.sh"],
  );
});

test("hook: unknown event and missing script", () => {
  const hooks = {
    hooks: {
      OnCoffee: [
        { hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/scripts/none.sh" }] },
      ],
    },
  };
  const r = parseArtifact({
    type: "hook",
    files: [{ path: "hooks.json", content: JSON.stringify(hooks) }],
    name: "coffee-hook",
    description: "Runs on coffee",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.warnings.some((w) => w.code === ISSUE_CODES.W_HOOK_EVENT_UNKNOWN));
  assert.ok(r.warnings.some((w) => w.code === ISSUE_CODES.W_SCRIPT_MISSING));
});

test("hook: invalid entry and invalid JSON", () => {
  const broken = {
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", timeout: 5 }] }] },
  };
  const r = parseArtifact({
    type: "hook",
    files: [{ path: "hooks.json", content: JSON.stringify(broken) }],
    name: "broken-hook",
    description: "Broken",
  });
  assert.equal(r.ok, false);
  const e =
    r.ok === false ? r.errors.find((i) => i.code === ISSUE_CODES.E_HOOK_ENTRY_INVALID) : undefined;
  assert.ok(e);
  assert.match(e?.path ?? "", /PreToolUse\[0\]\.hooks\[0\]/);
  const bad = parseArtifact({
    type: "hook",
    files: [{ path: "hooks.json", content: "{ not json" }],
    name: "x",
    description: "x",
  });
  assert.equal(bad.ok, false);
  assert.ok(
    bad.ok === false && bad.errors.some((i) => i.code === ISSUE_CODES.E_HOOKS_JSON_INVALID),
  );
});
