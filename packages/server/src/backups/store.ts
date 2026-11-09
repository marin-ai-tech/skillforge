import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Database } from "../db.ts";
import { vacuumInto } from "./snapshot.ts";
import { signingKeyIdOfPem } from "../signing/signer.ts";
import {
  SIGNING_KEY_PATH,
  buildManifest,
  collectBlobEntries,
  collectExtraEntries,
  writeBackupArchive,
  type BackupCounts,
  type BackupManifest,
} from "./archive.ts";

export type { BackupCounts, BackupManifest };

export const BACKUP_NAME_RE = /^skillforge-\d{8}T\d{6}Z\.tar\.gz$/;

export type BackupInfo = {
  name: string;
  size: number;
  created_at: string;
};

export type CreatedBackup = BackupInfo & {
  counts: BackupCounts;
};

export class BackupInProgressError extends Error {
  constructor() {
    super("backup_in_progress");
    this.name = "BackupInProgressError";
  }
}

export class BackupNotFoundError extends Error {
  constructor() {
    super("not_found");
    this.name = "BackupNotFoundError";
  }
}

let inProgress = false;

export function isBackupInProgress(): boolean {
  return inProgress;
}

/** Test helper — reset module mutex between tests. */
export function _resetBackupMutexForTests(): void {
  inProgress = false;
}

export function backupsDir(dataDir: string): string {
  return path.join(dataDir, "backups");
}

export function formatBackupStamp(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

export function makeBackupName(d: Date = new Date()): string {
  return `skillforge-${formatBackupStamp(d)}.tar.gz`;
}

export function isValidBackupName(name: string): boolean {
  return BACKUP_NAME_RE.test(name);
}

export function backupPath(dataDir: string, name: string): string {
  if (!isValidBackupName(name)) {
    throw new BackupNotFoundError();
  }
  return path.join(backupsDir(dataDir), name);
}

function countTable(db: Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
  return Number(row.c);
}

export async function collectCounts(db: Database, dataDir: string): Promise<BackupCounts> {
  const blobEntries = await collectBlobEntries(dataDir);
  return {
    users: countTable(db, "users"),
    artifacts: countTable(db, "artifacts"),
    versions: countTable(db, "artifact_versions"),
    blobs: blobEntries.length,
  };
}

function migrationsCount(db: Database): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number };
  return Number(row.c);
}

function ensureBackupsDir(dataDir: string): void {
  fs.mkdirSync(backupsDir(dataDir), { recursive: true });
}

function applyRetention(dataDir: string, keep: number): void {
  const dir = backupsDir(dataDir);
  if (!fs.existsSync(dir)) return;
  const names = fs
    .readdirSync(dir)
    .filter((f) => isValidBackupName(f))
    .sort()
    .reverse();
  for (const old of names.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, old));
    } catch {
      /* ignore */
    }
  }
}

export function listBackups(dataDir: string): { items: BackupInfo[]; dir: string } {
  const dir = backupsDir(dataDir);
  ensureBackupsDir(dataDir);
  const items: BackupInfo[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!isValidBackupName(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (!st.isFile()) continue;
    items.push({
      name,
      size: st.size,
      created_at: st.mtime.toISOString(),
    });
  }
  // Newest first: lexicographic on skillforge-<UTC> names, then mtime as tie-break.
  items.sort((a, b) => {
    if (a.name === b.name) return 0;
    return a.name < b.name ? 1 : -1;
  });
  return { items, dir };
}

export function deleteBackup(dataDir: string, name: string): void {
  const full = backupPath(dataDir, name);
  if (!fs.existsSync(full)) {
    throw new BackupNotFoundError();
  }
  fs.unlinkSync(full);
}

type CreateBackupArgs = {
  db: Database;
  dataDir: string;
  keep: number;
  serverVersion: string;
  /** Plugins directory; copied when it lies inside the data directory. */
  pluginsDir?: string;
};

/** key_id of the signing key file in the data directory, null when there is none. */
async function signingKeyId(dataDir: string): Promise<string | null> {
  const pem = await fs.promises.readFile(path.join(dataDir, SIGNING_KEY_PATH)).catch(() => null);
  return pem ? signingKeyIdOfPem(pem) : null;
}

/** Pick `skillforge-<UTC>.tar.gz`; if a same-second name exists, bump to the next second stamp. */
function pickBackupDest(dataDir: string): { name: string; dest: string } {
  let name = makeBackupName();
  let dest = path.join(backupsDir(dataDir), name);
  if (fs.existsSync(dest)) {
    name = makeBackupName(new Date(Date.now() + 1000));
    dest = path.join(backupsDir(dataDir), name);
  }
  return { name, dest };
}

async function runBackup(args: CreateBackupArgs, tmpRoot: string): Promise<CreatedBackup> {
  ensureBackupsDir(args.dataDir);
  await fs.promises.mkdir(tmpRoot, { recursive: true });
  const snapPath = path.join(tmpRoot, "skillforge.db");
  vacuumInto(args.db, snapPath);
  const blobEntries = await collectBlobEntries(args.dataDir);
  const extraEntries = await collectExtraEntries(args.dataDir, args.pluginsDir);
  const counts: BackupCounts = {
    users: countTable(args.db, "users"),
    artifacts: countTable(args.db, "artifacts"),
    versions: countTable(args.db, "artifact_versions"),
    blobs: blobEntries.length,
  };
  const createdAt = new Date().toISOString();
  const manifest = buildManifest({
    createdAt,
    serverVersion: args.serverVersion,
    migrations: migrationsCount(args.db),
    signingKeyId: await signingKeyId(args.dataDir),
    counts,
  });
  const { name, dest } = pickBackupDest(args.dataDir);
  const tmpOut = `${dest}.tmp-${randomBytes(4).toString("hex")}`;
  try {
    await writeBackupArchive({
      dbPath: snapPath,
      manifest,
      blobEntries,
      extraEntries,
      destPath: tmpOut,
    });
    await fs.promises.rename(tmpOut, dest);
  } catch (e) {
    await fs.promises.rm(tmpOut, { force: true }).catch(() => undefined);
    throw e;
  }
  applyRetention(args.dataDir, args.keep);
  const size = (await fs.promises.stat(dest)).size;
  return { name, size, created_at: createdAt, counts };
}

/**
 * Create a backup archive without blocking the event loop: DB snapshot via `VACUUM INTO`
 * into a temp dir, then tar + gzip streamed into `<dest>.tmp-…` and atomically renamed.
 * Only one backup at a time: the mutex is taken synchronously on call (before the first
 * await) and released when the returned Promise settles, on every path.
 */
export async function createBackup(args: CreateBackupArgs): Promise<CreatedBackup> {
  if (inProgress) {
    throw new BackupInProgressError();
  }
  inProgress = true;
  const tmpRoot = path.join(
    args.dataDir,
    `.backup-tmp-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  try {
    return await runBackup(args, tmpRoot);
  } finally {
    inProgress = false;
    await fs.promises.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
