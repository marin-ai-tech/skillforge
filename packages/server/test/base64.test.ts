import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBase64Strict } from "../src/lib/base64.ts";

const bytes = (s: string) => new Uint8Array(Buffer.from(s));

test("decodeBase64Strict accepts canonical input", () => {
  assert.deepEqual(decodeBase64Strict("QUJD"), bytes("ABC"));
  assert.deepEqual(decodeBase64Strict("QUI="), bytes("AB"));
  assert.deepEqual(decodeBase64Strict("QQ=="), bytes("A"));
  assert.deepEqual(decodeBase64Strict(""), new Uint8Array(0));
});

test("decodeBase64Strict accepts unpadded input with length % 4 in {2, 3}", () => {
  assert.deepEqual(decodeBase64Strict("QQ"), bytes("A"));
  assert.deepEqual(decodeBase64Strict("QUI"), bytes("AB"));
  assert.deepEqual(decodeBase64Strict("dGFpbA"), bytes("tail"));
});

test("decodeBase64Strict ignores whitespace (MIME line wrapping)", () => {
  const payload = Buffer.from("x".repeat(200));
  const wrapped = payload.toString("base64").replace(/(.{76})/g, "$1\r\n");
  assert.deepEqual(decodeBase64Strict(wrapped), new Uint8Array(payload));
  assert.deepEqual(decodeBase64Strict(" QU\nJD\t\r\n"), bytes("ABC"));
});

test("decodeBase64Strict rejects length % 4 == 1 (dangling symbol)", () => {
  assert.equal(decodeBase64Strict("QUJDR"), null);
  assert.equal(decodeBase64Strict("Q"), null);
  assert.equal(decodeBase64Strict("QUJDR==="), null);
});

test("decodeBase64Strict rejects non-zero trailing bits", () => {
  assert.equal(decodeBase64Strict("QR=="), null);
  assert.equal(decodeBase64Strict("QR"), null);
  assert.equal(decodeBase64Strict("QUJ="), null);
});

test("decodeBase64Strict rejects misplaced or excess padding", () => {
  assert.equal(decodeBase64Strict("QU=JD"), null);
  assert.equal(decodeBase64Strict("QUJD="), null);
  assert.equal(decodeBase64Strict("QQ="), null);
  assert.equal(decodeBase64Strict("QUI=="), null);
  assert.equal(decodeBase64Strict("Q==="), null);
  assert.equal(decodeBase64Strict("="), null);
});

test("decodeBase64Strict rejects characters outside the alphabet", () => {
  assert.equal(decodeBase64Strict("QUJD!"), null);
  assert.equal(decodeBase64Strict("QU-D"), null);
  assert.equal(decodeBase64Strict("QU_D"), null);
  assert.equal(decodeBase64Strict("QUJ\u0000D"), null);
});

test("decodeBase64Strict round-trips arbitrary bytes", () => {
  for (let n = 0; n < 16; n++) {
    const buf = Buffer.alloc(n, n * 37);
    assert.deepEqual(decodeBase64Strict(buf.toString("base64")), new Uint8Array(buf));
  }
});
