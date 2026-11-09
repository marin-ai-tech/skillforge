import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePath, prepareFiles } from "../src/artifact/paths.ts";
import { ISSUE_CODES } from "../src/artifact/types.ts";

test("normalizePath: slashify and strip ./", () => {
  const r = normalizePath(".\\foo\\bar.md");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.path, "foo/bar.md");
});

test("normalizePath: rejects .. and absolute", () => {
  const a = normalizePath("../etc/passwd");
  assert.equal(a.ok, false);
  if (!a.ok) assert.equal(a.code, "E_PATH_UNSAFE");
  const b = normalizePath("C:\\x\\SKILL.md");
  assert.equal(b.ok, false);
  if (!b.ok) assert.equal(b.code, "E_PATH_UNSAFE");
});

test("prepareFiles: node_modules forbidden", () => {
  const r = prepareFiles([
    { path: "SKILL.md", content: "x" },
    { path: "node_modules/left-pad/index.js", content: "x" },
  ]);
  assert.ok(r.errors.some((e) => e.code === ISSUE_CODES.E_PATH_FORBIDDEN));
});

test("prepareFiles: drops .DS_Store", () => {
  const r = prepareFiles([
    { path: "SKILL.md", content: "x" },
    { path: ".DS_Store", content: "x" },
  ]);
  assert.equal(r.files.length, 1);
  assert.ok(r.warnings.some((w) => w.code === ISSUE_CODES.W_FILE_DROPPED));
});

test("prepareFiles: strips common rootDir", () => {
  const r = prepareFiles([
    { path: "pdf-tools/SKILL.md", content: "a" },
    { path: "pdf-tools/references/REFERENCE.md", content: "b" },
  ]);
  assert.equal(r.rootDir, "pdf-tools");
  assert.deepEqual(r.files.map((f) => f.path).sort(), ["SKILL.md", "references/REFERENCE.md"]);
});

test("prepareFiles: duplicate paths", () => {
  const r = prepareFiles([
    { path: "a/SKILL.md", content: "1" },
    { path: "./a/SKILL.md", content: "2" },
  ]);
  assert.ok(r.errors.some((e) => e.code === ISSUE_CODES.E_PATH_DUPLICATE));
});

test("prepareFiles: 1001 files => E_TOO_MANY_FILES", () => {
  const files = [{ path: "SKILL.md", content: "x" }];
  for (let i = 0; i < 1000; i++) files.push({ path: `a${i}.txt`, content: "x" });
  const r = prepareFiles(files);
  assert.ok(r.errors.some((e) => e.code === ISSUE_CODES.E_TOO_MANY_FILES));
});
