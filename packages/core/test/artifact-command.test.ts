import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArtifact } from "../src/artifact/index.ts";
import { ISSUE_CODES } from "../src/artifact/types.ts";

test("command: propose.md OpenSpec", () => {
  const files = [
    { path: "propose.md", content: readFileSync("test/fixtures/command-propose/propose.md") },
  ];
  const r = parseArtifact({ type: "command", files });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.artifact.name, "propose");
  assert.equal(r.artifact.displayName, "OPSX: Propose");
  assert.ok(r.artifact.tags.includes("workflow"));
});

test("command: no frontmatter uses input.description", () => {
  const files = [{ path: "deploy.md", content: "Deploy the current branch.\n" }];
  const bad = parseArtifact({ type: "command", files });
  assert.equal(bad.ok, false);
  assert.ok(
    bad.ok === false && bad.errors.some((e) => e.code === ISSUE_CODES.E_DESCRIPTION_MISSING),
  );
  const good = parseArtifact({ type: "command", files, description: "Deploy to staging" });
  assert.equal(good.ok, true);
  if (!good.ok) return;
  assert.equal(good.artifact.frontmatter, null);
});

test("command: two md files", () => {
  const r = parseArtifact({
    type: "command",
    files: [
      { path: "a.md", content: "---\ndescription: A\n---\nA\n" },
      { path: "b.md", content: "---\ndescription: B\n---\nB\n" },
    ],
  });
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && r.errors.some((e) => e.code === ISSUE_CODES.E_SINGLE_FILE_REQUIRED));
});
