import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/db.ts";
import { getUserByUsername } from "../src/auth/users.ts";
import { seedAdmin, initialAdminPasswordPath, writeOwnerOnlyFile } from "../src/auth/seed.ts";
import { verifyPassword } from "../src/auth/passwords.ts";

test("seed from env does not write password file", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-seed-"));
  const db = openDatabase(dataDir);
  try {
    migrate(db);
    seedAdmin(db, dataDir, "env-admin-pw");
    assert.ok(!fs.existsSync(initialAdminPasswordPath(dataDir)));
    const user = getUserByUsername(db, "admin");
    assert.ok(user);
    assert.equal(verifyPassword("env-admin-pw", user!.password_hash), true);
    seedAdmin(db, dataDir, "other-pw");
    assert.equal(
      verifyPassword("env-admin-pw", getUserByUsername(db, "admin")!.password_hash),
      true,
    );
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("seed generated password writes file", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-seed-"));
  const db = openDatabase(dataDir);
  try {
    migrate(db);
    seedAdmin(db, dataDir, null);
    const file = initialAdminPasswordPath(dataDir);
    assert.ok(fs.existsSync(file));
    const pw = fs.readFileSync(file, "utf8").trim();
    assert.equal(pw.length, 20);
    assert.equal(verifyPassword(pw, getUserByUsername(db, "admin")!.password_hash), true);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("writeOwnerOnlyFile replaces a stale file and enforces 0600 on POSIX", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillforge-owner-only-"));
  try {
    const file = path.join(dir, "secret.txt");
    fs.writeFileSync(file, "old-secret", { mode: 0o644 });
    writeOwnerOnlyFile(file, "new-secret");
    assert.equal(fs.readFileSync(file, "utf8"), "new-secret");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
