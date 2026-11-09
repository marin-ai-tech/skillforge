import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, bundleDigest } from "../src/digest.ts";

const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

test("sha256Hex: empty string matches known empty digest", () => {
  assert.equal(sha256Hex(""), EMPTY);
});

test("sha256Hex: same bytes yield same digest regardless of representation", () => {
  const s = "hello";
  const bytes = new TextEncoder().encode(s);
  assert.equal(sha256Hex(s), sha256Hex(bytes));
});

test("bundleDigest: empty list equals sha256 of empty string", () => {
  assert.equal(bundleDigest([]), EMPTY);
  assert.equal(bundleDigest([]), sha256Hex(""));
});

test("bundleDigest: order of files does not change digest", () => {
  const a = { path: "a.txt", sha256: sha256Hex("A") };
  const b = { path: "b.txt", sha256: sha256Hex("B") };
  assert.equal(bundleDigest([a, b]), bundleDigest([b, a]));
});

test("bundleDigest: known vector a.txt=A b.txt=B", () => {
  const aSha = sha256Hex("A");
  const bSha = sha256Hex("B");
  const expectedRecord = `a.txt\0${aSha}\nb.txt\0${bSha}\n`;
  const expected = sha256Hex(expectedRecord);
  assert.equal(
    bundleDigest([
      { path: "b.txt", sha256: bSha },
      { path: "a.txt", sha256: aSha },
    ]),
    expected,
  );
});

test("bundleDigest: renaming a file changes digest with same content", () => {
  const sha = sha256Hex("same-bytes");
  const a = bundleDigest([{ path: "a.txt", sha256: sha }]);
  const b = bundleDigest([{ path: "b.txt", sha256: sha }]);
  assert.notEqual(a, b);
});
