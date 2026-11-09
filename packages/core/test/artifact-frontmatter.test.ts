import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFrontmatter, extractTags } from "../src/artifact/frontmatter.ts";
import { ISSUE_CODES } from "../src/artifact/types.ts";

test("extractFrontmatter: valid YAML", () => {
  const r = extractFrontmatter("---\nname: demo\ntags: [A, B]\n---\n\nBody\n");
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.frontmatter?.tags, ["A", "B"]);
  assert.match(r.body, /Body/);
});

test("extractFrontmatter: loose fallback for nested colon", () => {
  const r = extractFrontmatter(
    "---\nname: loose-skill\ndescription: migrate: nutrition subsystem\ntriggers: nutrition, hunger\n---\n\nBody.\n",
  );
  assert.ok(r.warnings.some((w) => w.code === ISSUE_CODES.W_FRONTMATTER_LOOSE));
  assert.equal(r.frontmatter?.description, "migrate: nutrition subsystem");
  assert.deepEqual(r.frontmatter?.triggers, ["nutrition", "hunger"]);
});

test("extractFrontmatter: missing closing fence", () => {
  const r = extractFrontmatter("---\nname: x\n");
  assert.ok(r.errors.some((e) => e.code === ISSUE_CODES.E_FRONTMATTER_INVALID));
});

test("extractTags: tags + category lowercase dedupe", () => {
  const tags = extractTags({ tags: ["Workflow", "artifacts"], category: "Workflow" });
  assert.deepEqual(tags, ["workflow", "artifacts"]);
});

test("extractFrontmatter: no block", () => {
  const r = extractFrontmatter("Just body\n");
  assert.equal(r.hasBlock, false);
  assert.equal(r.frontmatter, null);
});
