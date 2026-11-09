import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  newImportId,
  saveImport,
  loadImport,
  deleteImport,
  cleanupExpiredImports,
} from "../src/imports/store.ts";

test("store: save load owner expire delete", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-imp-"));
  try {
    const id = newImportId();
    assert.equal(id.length, 32);
    const now = new Date();
    saveImport(
      dataDir,
      id,
      {
        user_id: "u1",
        kind: "files",
        ref: "files",
        expires_at: new Date(now.getTime() + 60_000).toISOString(),
        created_at: now.toISOString(),
      },
      [{ path: "a.md", content: new Uint8Array([1, 2, 3]) }],
    );
    const ok = loadImport(dataDir, id, "u1", now);
    assert.equal(ok.ok, true);
    const forbidden = loadImport(dataDir, id, "other", now);
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) assert.equal(forbidden.error, "forbidden");
    const expired = loadImport(dataDir, id, "u1", new Date(now.getTime() + 120_000));
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.error, "expired");
    const missing = loadImport(dataDir, "0".repeat(32), "u1", now);
    assert.equal(missing.ok, false);
    deleteImport(dataDir, id);
    assert.equal(loadImport(dataDir, id, "u1", now).ok, false);
    // expired cleanup
    const id2 = newImportId();
    saveImport(
      dataDir,
      id2,
      {
        user_id: "u1",
        kind: "zip",
        ref: "zip",
        expires_at: new Date(now.getTime() - 1000).toISOString(),
        created_at: now.toISOString(),
      },
      [{ path: "b.md", content: new Uint8Array([4]) }],
    );
    assert.ok(cleanupExpiredImports(dataDir, now) >= 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
