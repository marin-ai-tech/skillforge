import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArtifact } from "../src/artifact/index.ts";
import { ISSUE_CODES } from "../src/artifact/types.ts";

test("skill: standard fixture with references", () => {
  const files = [
    {
      path: "pdf-tools/SKILL.md",
      content: readFileSync("test/fixtures/skill-standard/pdf-tools/SKILL.md"),
    },
    {
      path: "pdf-tools/references/REFERENCE.md",
      content: readFileSync("test/fixtures/skill-standard/pdf-tools/references/REFERENCE.md"),
    },
  ];
  const r = parseArtifact({ type: "skill", files });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.artifact.name, "pdf-tools");
  assert.deepEqual(
    r.artifact.files.map((f) => f.path),
    ["skills/pdf-tools/SKILL.md", "skills/pdf-tools/references/REFERENCE.md"],
  );
});

test("skill: reckon single-file", () => {
  const files = [
    {
      path: "nutrition-migration.md",
      content: readFileSync("test/fixtures/skill-reckon/nutrition-migration.md"),
    },
  ];
  const r = parseArtifact({ type: "skill", files });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.artifact.name, "nutrition-migration");
  assert.ok(r.warnings.some((w) => w.code === ISSUE_CODES.W_SINGLE_FILE_SKILL));
  assert.ok(
    r.warnings.some(
      (w) => w.code === ISSUE_CODES.W_UNKNOWN_FRONTMATTER_KEY && /status/.test(w.message),
    ),
  );
});

test("skill: missing reference warning", () => {
  const r = parseArtifact({
    type: "skill",
    files: [
      {
        path: "SKILL.md",
        content:
          "---\nname: linker\ndescription: Links things.\n---\n\nSee [guide](references/guide.md).\n",
      },
    ],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const w = r.warnings.find((i) => i.code === ISSUE_CODES.W_REFERENCE_MISSING);
  assert.ok(w);
  assert.equal(w?.path, "references/guide.md");
});

test("skill: SKILL.md without frontmatter -> E_FRONTMATTER_MISSING", () => {
  const r = parseArtifact({
    type: "skill",
    files: [{ path: "SKILL.md", content: "# Title\n\nJust a body without frontmatter.\n" }],
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(
    r.errors.some((e) => e.code === ISSUE_CODES.E_FRONTMATTER_MISSING),
    JSON.stringify(r.errors),
  );
  assert.ok(
    !r.errors.some((e) => e.code === ISSUE_CODES.E_NAME_INVALID),
    "should not emit E_NAME_INVALID when frontmatter is missing",
  );
});
