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

// bundle-limits: at most 4000 files and 64 MiB per bundle (the import limits are 5000 files and 64 MiB).
const MiB = 1024 * 1024;
const many = (n: number) => {
  const files: Array<{ path: string; content: string | Uint8Array }> = [
    { path: "SKILL.md", content: "x" },
  ];
  for (let i = 1; i < n; i++) files.push({ path: `a${i}.txt`, content: "x" });
  return files;
};
const codes = (r: ReturnType<typeof prepareFiles>) => r.errors.map((e) => e.code);

test("prepareFiles: 4000 files pass, 4001 => E_TOO_MANY_FILES", () => {
  assert.ok(!codes(prepareFiles(many(4000))).includes(ISSUE_CODES.E_TOO_MANY_FILES), "4000 files");
  assert.ok(prepareFiles(many(4001)).errors.some((e) => e.code === ISSUE_CODES.E_TOO_MANY_FILES));
});

test("prepareFiles: 64 MiB pass, one byte more => E_BUNDLE_TOO_LARGE", () => {
  const chunk = (n: number) => new Uint8Array(n);
  const files = (extra: number) => [
    { path: "SKILL.md", content: "x" },
    ...Array.from({ length: 4 }, (_, i) => ({
      path: `big${i}.bin`,
      content: chunk(16 * MiB - (i === 0 ? 1 : 0)),
    })),
    { path: "tail.txt", content: chunk(extra) },
  ];
  // SKILL.md (1 byte) + 4 x 16 MiB - 1 byte = exactly 64 MiB
  assert.ok(!codes(prepareFiles(files(0))).includes(ISSUE_CODES.E_BUNDLE_TOO_LARGE), "64 MiB");
  assert.ok(
    codes(prepareFiles(files(1))).includes(ISSUE_CODES.E_BUNDLE_TOO_LARGE),
    "64 MiB + 1 byte",
  );
  // negative: one file over 16 MiB is still refused on its own
  const one = prepareFiles([
    { path: "SKILL.md", content: "x" },
    { path: "huge.bin", content: chunk(16 * MiB + 1) },
  ]);
  assert.ok(codes(one).includes(ISSUE_CODES.E_FILE_TOO_LARGE));
});
