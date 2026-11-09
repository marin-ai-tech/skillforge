import type { Database } from "../db.ts";

/** Escape a filesystem path for use as a SQLite string literal. */
export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Create a consistent DB snapshot via VACUUM INTO (includes WAL content).
 * `targetPath` must not already exist.
 */
export function vacuumInto(db: Database, targetPath: string): void {
  db.exec(`VACUUM INTO ${sqlStringLiteral(targetPath)}`);
}
