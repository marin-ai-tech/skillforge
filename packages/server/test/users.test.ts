import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/db.ts";
import { createUser, roleAtLeast, validatePassword, validateUsername } from "../src/auth/users.ts";

test("username/password validation and roles", () => {
  assert.equal(validateUsername("ab"), true);
  assert.equal(validateUsername("a"), false);
  assert.equal(validateUsername("Bad Name"), false);
  assert.equal(validatePassword("1234567"), false);
  assert.equal(validatePassword("12345678"), true);
  assert.equal(roleAtLeast("reviewer", "contributor"), true);
  assert.equal(roleAtLeast("viewer", "contributor"), false);
});

test("createUser uniqueness case-insensitive", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-users-"));
  const db = openDatabase(dataDir);
  try {
    migrate(db);
    const a = createUser(db, { username: "Alice", password: "password1", role: "viewer" });
    assert.equal(a.ok, true);
    if (a.ok) assert.equal(a.user.username, "alice");
    const dup = createUser(db, { username: "alice", password: "password2", role: "viewer" });
    assert.equal(dup.ok, false);
    if (!dup.ok) assert.equal(dup.error, "username_taken");
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
