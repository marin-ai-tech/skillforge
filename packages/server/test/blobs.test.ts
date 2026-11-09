import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256Hex } from "@skillforge/core";
import { blobPath, hasBlob, putBlob, readBlob } from "../src/blobs.ts";

test("putBlob writes blobs/<ab>/<sha>, noop on second write, read matches", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-blobs-"));
  try {
    const content = new TextEncoder().encode("hello blob");
    const sha = sha256Hex(content);
    const sha1 = putBlob(dataDir, content);
    assert.equal(sha1, sha);
    const p = blobPath(dataDir, sha);
    assert.equal(p, path.join(dataDir, "blobs", sha.slice(0, 2), sha));
    assert.ok(fs.existsSync(p));
    assert.ok(hasBlob(dataDir, sha));
    const mtime1 = fs.statSync(p).mtimeMs;
    const again = putBlob(dataDir, content);
    assert.equal(again, sha);
    assert.equal(fs.statSync(p).mtimeMs, mtime1);
    const read = readBlob(dataDir, sha);
    assert.deepEqual(Buffer.from(read), Buffer.from(content));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("blobPath uses first two hex chars", () => {
  const dataDir = "/tmp/data";
  assert.equal(
    blobPath(dataDir, "abcdef0123456789"),
    path.join(dataDir, "blobs", "ab", "abcdef0123456789"),
  );
});
