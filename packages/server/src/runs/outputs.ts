import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { sha256Hex, type SpawnIsolatedResult } from "@skillforge/core";
import { appendAudit, type Database } from "../repo.ts";

/**
 * Run output store.
 *
 * Index rows live in `run_outputs`; content lives in a dedicated content-addressed store
 * `<dataDir>/run-outputs/<aa>/<sha256>`, separate from the artifact blob store, so purge and
 * retention count references per store. Content is never written to audit or logs.
 */

export const RUN_OUTPUTS_DIR = "run-outputs";
export const DEFAULT_RUN_OUTPUT_RETENTION_DAYS = 30;
export const DEFAULT_RUN_OUTPUT_MAX_BYTES = 1024 * 1024;

const SHA_RE = /^[a-f0-9]{64}$/u;
const NAME_MAX = 200;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RunOutputSettings = { retentionDays: number; maxBytes: number };

let settings: RunOutputSettings = {
  retentionDays: DEFAULT_RUN_OUTPUT_RETENTION_DAYS,
  maxBytes: DEFAULT_RUN_OUTPUT_MAX_BYTES,
};
let lastPruneAt = 0;

/** Apply SKILLFORGE_RUN_OUTPUT_* settings (called by buildApp). */
export function configureRunOutputs(next: Partial<RunOutputSettings>): void {
  settings = { ...settings, ...next };
}

export function runOutputSettings(): RunOutputSettings {
  return { ...settings };
}

export type RunOutputStream = "stdout" | "stderr" | "trace" | "file";

export type RunOutputRow = {
  id: number;
  run_id: string;
  run_kind: string;
  artifact_id: string;
  version: string;
  stream: RunOutputStream;
  name: string | null;
  sha256: string;
  size: number;
  truncated: number;
  exit_code: number | null;
  timed_out: number;
  duration_ms: number | null;
  created_by: string;
  created_at: string;
  expires_at: string | null;
};

export type RecordRunOutputsInput = {
  runId: string;
  runKind: string;
  artifactId: string;
  version: string;
  name?: string | null;
  actor: string;
  /** Clock override (tests). */
  now?: Date;
};

export function runOutputPath(dataDir: string, sha: string): string {
  if (!SHA_RE.test(sha)) throw new Error("invalid run output sha256");
  return path.join(dataDir, RUN_OUTPUTS_DIR, sha.slice(0, 2), sha);
}

/** Atomic content-addressed write (tmp + rename) into data/run-outputs. */
function writeRunOutput(dataDir: string, content: Uint8Array): string {
  const sha = sha256Hex(content);
  const target = runOutputPath(dataDir, sha);
  if (fs.existsSync(target)) return sha;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${randomBytes(8).toString("hex")}`;
  fs.writeFileSync(tmp, content);
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    if (!fs.existsSync(target)) throw e;
  }
  return sha;
}

/** Stored content, or null when the file is gone (purged, pruned or not restored). */
export function readRunOutputContent(dataDir: string, sha256: string): Buffer | null {
  try {
    return fs.readFileSync(runOutputPath(dataDir, sha256));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Unlink a content file when no run_outputs row references it any more. */
export function unlinkRunOutputIfUnreferenced(db: Database, dataDir: string, sha: string): boolean {
  if (!SHA_RE.test(sha)) return false;
  if (db.prepare("SELECT 1 AS n FROM run_outputs WHERE sha256 = ? LIMIT 1").get(sha)) return false;
  try {
    fs.unlinkSync(runOutputPath(dataDir, sha));
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

type StreamDraft = { stream: RunOutputStream; text: string; truncated: boolean };

/** stdout/stderr of a SpawnIsolatedResult; a spawn error is stored as stderr. */
function streamsOf(result: SpawnIsolatedResult): StreamDraft[] {
  const stderr = result.error
    ? result.stderr
      ? `${result.stderr}\n${result.error}`
      : result.error
    : result.stderr;
  return [
    { stream: "stdout", text: result.stdout ?? "", truncated: result.outTruncated },
    { stream: "stderr", text: stderr ?? "", truncated: result.errTruncated },
  ];
}

function expiresAt(now: Date): string | null {
  if (settings.retentionDays <= 0) return null;
  return new Date(now.getTime() + settings.retentionDays * DAY_MS).toISOString();
}

/**
 * True when the target artifact or version is gone or tombstoned: a purge committed between
 * the run's start and output write must not resurrect rows the erasers just removed.
 */
function targetPurged(db: Database, artifactId: string, version: string): boolean {
  const art = db.prepare("SELECT purged_at FROM artifacts WHERE id = ?").get(artifactId) as
    { purged_at: string | null } | undefined;
  if (!art || art.purged_at) return true;
  const ver = db
    .prepare("SELECT purged_at FROM artifact_versions WHERE artifact_id = ? AND version = ?")
    .get(artifactId, version) as { purged_at: string | null } | undefined;
  return !ver || ver.purged_at !== null;
}

/**
 * Record the output of one isolated run: one row per non-empty stream (stdout, stderr).
 * Streams larger than SKILLFORGE_RUN_OUTPUT_MAX_BYTES are rejected (not stored).
 * Returns the ids of the inserted rows.
 */
export function recordRunOutputs(
  db: Database,
  dataDir: string,
  input: RecordRunOutputsInput,
  result: SpawnIsolatedResult,
): number[] {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const name = input.name ? input.name.slice(0, NAME_MAX) : null;
  const exitCode = result.error ? null : result.code;
  if (targetPurged(db, input.artifactId, input.version)) return [];
  const insert = db.prepare(
    `INSERT INTO run_outputs (run_id, run_kind, artifact_id, version, stream, name, sha256, size,
       truncated, exit_code, timed_out, duration_ms, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ids: number[] = [];
  for (const draft of streamsOf(result)) {
    if (!draft.text) continue;
    const content = Buffer.from(draft.text, "utf8");
    if (content.byteLength > settings.maxBytes) continue;
    const sha = writeRunOutput(dataDir, content);
    const info = insert.run(
      input.runId,
      input.runKind,
      input.artifactId,
      input.version,
      draft.stream,
      name,
      sha,
      content.byteLength,
      draft.truncated ? 1 : 0,
      exitCode,
      result.timedOut ? 1 : 0,
      Number.isFinite(result.duration_ms) ? Math.round(result.duration_ms) : null,
      input.actor,
      createdAt,
      expiresAt(now),
    );
    ids.push(Number(info.lastInsertRowid));
  }
  if (now.getTime() - lastPruneAt >= PRUNE_INTERVAL_MS) {
    try {
      pruneRunOutputs(db, dataDir, now);
    } catch {
      /* retention is best effort on write */
    }
  }
  return ids;
}

/** Content files without any run_outputs row (left by a failed post-commit unlink). */
function sweepOrphans(db: Database, dataDir: string, now: Date): number {
  const root = path.join(dataDir, RUN_OUTPUTS_DIR);
  if (!fs.existsSync(root)) return 0;
  let removed = 0;
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const entry of fs.readdirSync(path.join(root, dir.name), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const full = path.join(root, dir.name, entry.name);
      if (now.getTime() - fs.statSync(full).mtimeMs < ORPHAN_GRACE_MS) continue;
      if (!SHA_RE.test(entry.name)) {
        // Stale tmp file of an interrupted atomic write.
        fs.unlinkSync(full);
        removed++;
      } else if (unlinkRunOutputIfUnreferenced(db, dataDir, entry.name)) removed++;
    }
  }
  return removed;
}

/**
 * Store one arbitrary stream (e.g. a JSON "trace") of a run. Returns the row id, or null
 * when the content exceeds SKILLFORGE_RUN_OUTPUT_MAX_BYTES.
 */
export function storeRunOutputStream(
  db: Database,
  dataDir: string,
  input: RecordRunOutputsInput & { stream: RunOutputStream },
  content: string | Uint8Array,
): number | null {
  const now = input.now ?? new Date();
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  if (!bytes.byteLength || bytes.byteLength > settings.maxBytes) return null;
  if (targetPurged(db, input.artifactId, input.version)) return null;
  const name = input.name ? input.name.slice(0, NAME_MAX) : null;
  const sha = writeRunOutput(dataDir, bytes);
  const info = db
    .prepare(
      `INSERT INTO run_outputs (run_id, run_kind, artifact_id, version, stream, name, sha256, size,
         truncated, exit_code, timed_out, duration_ms, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL, ?, ?, ?)`,
    )
    .run(
      input.runId,
      input.runKind,
      input.artifactId,
      input.version,
      input.stream,
      name,
      sha,
      bytes.byteLength,
      input.actor,
      now.toISOString(),
      expiresAt(now),
    );
  return Number(info.lastInsertRowid);
}

/**
 * Retention: delete expired rows and unreferenced content files; one audit row
 * `run_outputs_prune` per affected artifact with counts only (no content, no run id).
 */
export function pruneRunOutputs(
  db: Database,
  dataDir: string,
  now: Date = new Date(),
): { rows: number; files: number } {
  lastPruneAt = now.getTime();
  const cutoff = now.toISOString();
  const expired = db
    .prepare(
      "SELECT artifact_id, sha256 FROM run_outputs WHERE expires_at IS NOT NULL AND expires_at <= ?",
    )
    .all(cutoff) as Array<{ artifact_id: string; sha256: string }>;
  db.prepare("DELETE FROM run_outputs WHERE expires_at IS NOT NULL AND expires_at <= ?").run(
    cutoff,
  );
  const perArtifact = new Map<string, { rows: number; shas: Set<string> }>();
  for (const r of expired) {
    const entry = perArtifact.get(r.artifact_id) ?? { rows: 0, shas: new Set<string>() };
    entry.rows++;
    entry.shas.add(r.sha256);
    perArtifact.set(r.artifact_id, entry);
  }
  let files = 0;
  for (const [artifactId, entry] of perArtifact) {
    let removed = 0;
    for (const sha of entry.shas) {
      try {
        if (unlinkRunOutputIfUnreferenced(db, dataDir, sha)) removed++;
      } catch {
        /* left for the orphan sweep */
      }
    }
    files += removed;
    appendAudit(db, {
      ts: cutoff,
      actor: "system",
      artifact_id: artifactId,
      version: null,
      action: "run_outputs_prune",
      meta: { rows: entry.rows, files: removed },
    });
  }
  try {
    files += sweepOrphans(db, dataDir, now);
  } catch {
    /* best effort */
  }
  return { rows: expired.length, files };
}
