import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/db.ts";
import { createUser } from "../src/auth/users.ts";
import { createToken, randomBase62, resolveToken, revokeToken } from "../src/auth/tokens.ts";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

test("token resolve and revoke", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-tok-"));
  const db = openDatabase(dataDir);
  try {
    migrate(db);
    const u = createUser(db, { username: "u1", password: "password1", role: "contributor" });
    assert.ok(u.ok);
    if (!u.ok) return;
    const created = createToken(db, u.user.id, "ci");
    assert.match(created.token, /^sf_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
    assert.ok(resolveToken(db, created.token));
    assert.equal(revokeToken(db, u.user.id, created.row.id), true);
    assert.equal(resolveToken(db, created.token), null);
  } finally {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("randomBase62 alphabet covers all 62 chars over 10000 samples", () => {
  const seen = new Set<string>();
  const total = 10_000;
  for (let i = 0; i < total; i++) {
    const s = randomBase62(1);
    assert.equal(s.length, 1);
    assert.ok(BASE62.includes(s), `unexpected char ${s}`);
    seen.add(s);
  }
  assert.equal(seen.size, 62, `expected all 62 symbols, got ${seen.size}`);
});
