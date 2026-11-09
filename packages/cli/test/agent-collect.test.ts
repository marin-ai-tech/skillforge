import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Smoke: CLI agent module is present; detailed behavior in tests/cli-agent.test.mjs.
test("packages/cli agent command module is present", () => {
  const p = path.resolve("src/commands/agent.ts");
  assert.ok(fs.existsSync(p), p);
  const text = fs.readFileSync(p, "utf8");
  assert.ok(text.includes("runAgentScan"));
  assert.ok(text.includes("runAgentPublish"));
});
