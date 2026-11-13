import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { collectPublishFiles, unzipBundle } from "../src/bundle.ts";

test("collectPublishFiles single file uses basename", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bun-"));
  const file = path.join(dir, "propose.md");
  fs.writeFileSync(file, "---\nname: propose\n---\n");
  const files = collectPublishFiles(file);
  assert.equal(files.length, 1);
  assert.equal(files[0]!.path, "propose.md");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("collectPublishFiles keeps rules/ for one .md in a rules folder (file or folder), not for other folders", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-bun-"));
  const put = (rel: string) => {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "---\nname: x\n---\n");
    return file;
  };
  assert.equal(collectPublishFiles(put("a/rules/api-style.md"))[0]!.path, "rules/api-style.md");
  put("b/team/rules/team-habits.md");
  assert.equal(collectPublishFiles(path.join(dir, "b"))[0]!.path, "rules/team-habits.md");
  assert.equal(collectPublishFiles(put("c/commands/review.md"))[0]!.path, "review.md");
  put("d/commands/review.md");
  assert.equal(collectPublishFiles(path.join(dir, "d"))[0]!.path, "review.md");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("unzipBundle rejects .. and absolute paths", () => {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), "sf-into-"));
  const badDot = zipSync({ "../escape.txt": new TextEncoder().encode("x") });
  assert.throws(() => unzipBundle(badDot, into), /unsafe|rejected/i);
  const badAbs = zipSync({ "/tmp/abs.txt": new TextEncoder().encode("x") });
  assert.throws(() => unzipBundle(badAbs, into), /unsafe|rejected/i);
  const badSlash = zipSync({ "foo\\bar.txt": new TextEncoder().encode("x") });
  assert.throws(() => unzipBundle(badSlash, into), /unsafe|rejected/i);
  fs.rmSync(into, { recursive: true, force: true });
});
