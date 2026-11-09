import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArtifact } from "../src/artifact/index.ts";
import { ISSUE_CODES } from "../src/artifact/types.ts";

test("agent: handoff-executor tools array", () => {
  const files = [
    {
      path: "handoff-executor.md",
      content: readFileSync("test/fixtures/agent-executor/handoff-executor.md"),
    },
  ];
  const r = parseArtifact({ type: "agent", files });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.artifact.name, "handoff-executor");
  assert.deepEqual(r.artifact.frontmatter?.tools, [
    "Bash",
    "PowerShell",
    "Write",
    "Read",
    "Glob",
    "Grep",
  ]);
});

test("agent: missing description and bad isolation", () => {
  const noDesc = parseArtifact({
    type: "agent",
    files: [{ path: "x.md", content: "---\nname: x\n---\nPrompt.\n" }],
  });
  assert.equal(noDesc.ok, false);
  assert.ok(
    noDesc.ok === false && noDesc.errors.some((e) => e.code === ISSUE_CODES.E_DESCRIPTION_MISSING),
  );
  const iso = parseArtifact({
    type: "agent",
    files: [
      {
        path: "x.md",
        content: "---\nname: x\ndescription: X agent\nisolation: docker\n---\nPrompt.\n",
      },
    ],
  });
  assert.equal(iso.ok, false);
  assert.ok(
    iso.ok === false && iso.errors.some((e) => e.code === ISSUE_CODES.E_AGENT_ISOLATION_INVALID),
  );
});
