import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArtifact, detectArtifactType } from "../src/artifact/index.ts";
import { ISSUE_CODES } from "../src/artifact/types.ts";

test("parseArtifact: digest stable under file reorder", () => {
  const files = [
    { path: "SKILL.md", content: "---\nname: s\ndescription: S skill here.\n---\n\nBody.\n" },
    { path: "references/a.md", content: "a" },
  ];
  const a = parseArtifact({ type: "skill", files });
  const b = parseArtifact({ type: "skill", files: [...files].reverse() });
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(a.artifact.digest, b.artifact.digest);
});

test("parseArtifact: E_TYPE_UNKNOWN", () => {
  const r = parseArtifact({ type: "widget", files: [{ path: "a.md", content: "x" }] });
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && r.errors.some((e) => e.code === ISSUE_CODES.E_TYPE_UNKNOWN));
});

test("detectArtifactType: all branches", () => {
  assert.equal(detectArtifactType([{ path: "hooks.json", content: "{}" }]), "hook");
  assert.equal(
    detectArtifactType([{ path: "x/SKILL.md", content: "---\nname: x\ndescription: X\n---\nB" }]),
    "skill",
  );
  assert.equal(
    detectArtifactType([
      { path: "a.md", content: "---\nname: a\ndescription: A\nmodel: sonnet\n---\nPrompt" },
    ]),
    "agent",
  );
  assert.equal(detectArtifactType([{ path: "b.md", content: "Just a prompt body." }]), "command");
  assert.equal(
    detectArtifactType([
      { path: "a.txt", content: "x" },
      { path: "b.txt", content: "y" },
    ]),
    null,
  );
});
