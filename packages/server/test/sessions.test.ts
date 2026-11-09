import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/db.ts";
import { createUser } from "../src/auth/users.ts";
import { createSession, getSession } from "../src/auth/sessions.ts";

test("expired session is not found", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-sess-"));
  const db = openDatabase(dataDir);
  try {
    migrate(db);
    const u = createUser(db, { username: "u1", password: "password1", role: "viewer" });
    assert.ok(u.ok);
    if (!u.ok) return;
    const past = new Date(Date.now() - 60_000);
    const session = createSession(db, u.user.id, 30, past);
    // Force expiry
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(
      past.toISOString(),
      session.id,
    );
    assert.equal(getSession(db, session.id), null);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
