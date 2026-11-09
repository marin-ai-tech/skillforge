import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth/passwords.ts";

test("hashPassword format and verify true/false", () => {
  const hash = hashPassword("secret-password");
  assert.ok(hash.startsWith("scrypt$"));
  const parts = hash.split("$");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "scrypt");
  assert.ok(parts[1] && parts[1].length > 0);
  assert.ok(parts[2] && parts[2].length > 0);
  assert.ok(!hash.includes("secret-password"));
  assert.equal(verifyPassword("secret-password", hash), true);
  assert.equal(verifyPassword("wrong-password", hash), false);
  assert.equal(verifyPassword("secret-password", "not-a-hash"), false);
});
