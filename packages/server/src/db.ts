import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../migrations");
}

export function openDatabase(dataDir: string): Database {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "blobs"), { recursive: true });
  const dbPath = path.join(dataDir, "skillforge.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA secure_delete = ON");
  return db;
}

export function migrate(db: Database): void {
  // Ensure tracking table exists before reading applied set (bootstrap chicken-egg:
  // 0001 creates schema_migrations; for first run we apply all files in order).
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) {
    throw new Error(`migrations directory not found: ${dir}`);
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/u.test(f))
    .sort((a, b) => a.localeCompare(b));

  // Create schema_migrations if absent so we can query applied set.
  // 0001_init.sql also creates it; IF NOT EXISTS keeps this idempotent.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT name FROM schema_migrations")
      .all()
      .map((row) => String((row as { name: string }).name)),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const id = Number(file.slice(0, 4));
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        id,
        file,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
