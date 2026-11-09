import { test } from "node:test";
import assert from "node:assert/strict";
import { RUNTIME_IDS } from "../src/runtimes/table.ts";
import {
  AgentDeclarationError,
  formatAgentDeclarations,
  parseAgentDeclarations,
  supportedAgents,
} from "../src/runtimes/compat.ts";

test("supportedAgents: skills go everywhere, hooks/plugins/settings only to Claude Code", () => {
  assert.deepEqual(supportedAgents("skill"), [...RUNTIME_IDS]);
  for (const t of ["hook", "plugin", "settings"] as const)
    assert.deepEqual(supportedAgents(t), ["claude-code"]);
  assert.ok(!supportedAgents("command").includes("codex"), "codex has no commands");
  assert.ok(!supportedAgents("agent").includes("gemini"), "gemini has no subagents");
});

test("parseAgentDeclarations: string, array of objects and strings, order kept", () => {
  assert.deepEqual(parseAgentDeclarations("claude-code>=2.1, codex", "skill"), [
    { runtime: "claude-code", min_version: "2.1" },
    { runtime: "codex", min_version: null },
  ]);
  assert.deepEqual(
    parseAgentDeclarations([{ runtime: "opencode", min_version: "1.0.3" }, "qwen>=0.4"], "skill"),
    [
      { runtime: "opencode", min_version: "1.0.3" },
      { runtime: "qwen", min_version: "0.4" },
    ],
  );
  assert.deepEqual(parseAgentDeclarations(null, "skill"), []);
  assert.deepEqual(parseAgentDeclarations("", "skill"), []);
});

test("parseAgentDeclarations: rejects with a reader-facing reason", () => {
  const cases: Array<[unknown, Parameters<typeof parseAgentDeclarations>[1], RegExp]> = [
    ["unknown-agent", "skill", /unknown agent "unknown-agent"/],
    ["codex>=2.x", "skill", /must look like/],
    ["codex, codex", "skill", /listed twice/],
    ["codex", "hook", /hooks are not supported by codex/],
    ["codex", "command", /commands are not supported by codex/],
    [[{ runtime: 5 }], "skill", /needs a runtime/],
    [42, "skill", /list or a comma-separated string/],
    ["codex>=1; rm -rf /", "skill", /is not "agent" or "agent>=version"/],
  ];
  for (const [input, type, re] of cases) {
    assert.throws(
      () => parseAgentDeclarations(input, type),
      (e: unknown) => e instanceof AgentDeclarationError && re.test(e.message),
      String(input),
    );
  }
});

test("formatAgentDeclarations is the inverse of the string form", () => {
  const list = parseAgentDeclarations("claude-code>=2.1,codex", "skill");
  assert.equal(formatAgentDeclarations(list), "claude-code>=2.1, codex");
  assert.deepEqual(parseAgentDeclarations(formatAgentDeclarations(list), "skill"), list);
});
