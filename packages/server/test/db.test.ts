import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, migrate } from "../src/db.ts";

const MIGRATION_FILES = fs
  .readdirSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations"))
  .filter((f) => /^\d{4}_.+\.sql$/u.test(f))
  .sort();

test("openDatabase creates dataDir, blobs, and skillforge.db", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-db-"));
  try {
    const db = openDatabase(dataDir);
    try {
      assert.ok(fs.existsSync(path.join(dataDir, "blobs")));
      assert.ok(fs.existsSync(path.join(dataDir, "skillforge.db")));
      migrate(db);
      const row = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as {
        n: number | bigint;
      };
      assert.ok(Number(row.n) >= 1);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("migrate is idempotent", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-db-"));
  try {
    const db = openDatabase(dataDir);
    try {
      migrate(db);
      const before = Number(
        (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number | bigint })
          .n,
      );
      migrate(db);
      const after = Number(
        (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number | bigint })
          .n,
      );
      assert.equal(after, before);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("migrate applies every file in migrations/ including agents, quality, token mcp and duplicates", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-db-"));
  try {
    const db = openDatabase(dataDir);
    try {
      migrate(db);
      const names = db
        .prepare("SELECT name FROM schema_migrations ORDER BY id")
        .all()
        .map((r) => String((r as { name: string }).name));
      assert.deepEqual([...names].sort(), MIGRATION_FILES, JSON.stringify(names));
      assert.ok(names.includes("0002_artifacts.sql"), JSON.stringify(names));
      assert.ok(names.includes("0003_auth.sql"), JSON.stringify(names));
      assert.ok(names.includes("0004_downloads.sql"), JSON.stringify(names));
      assert.ok(names.includes("0005_plugins.sql"), JSON.stringify(names));
      assert.ok(names.includes("0006_agents.sql"), JSON.stringify(names));
      assert.ok(names.includes("0007_quality.sql"), JSON.stringify(names));
      assert.ok(names.includes("0008_token_mcp.sql"), JSON.stringify(names));
      assert.ok(names.includes("0009_duplicates.sql"), JSON.stringify(names));
      for (const table of [
        "artifacts",
        "artifact_versions",
        "audit_events",
        "users",
        "sessions",
        "api_tokens",
        "plugins",
        "agents",
        "agent_items",
        "plugin_migrations",
      ]) {
        const row = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table);
        assert.ok(row, `missing table ${table}`);
      }
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
