import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  isArtifactType,
  isRuntimeId,
  parseArtifact,
  runtimeDef,
  runtimeSupport,
  scanImportTree,
  validateName,
  type ArtifactType,
} from "@skillforge/core";
import { putBlob } from "../blobs.ts";
import { dedupeSnapshotItems, type DuplicateGroup } from "./duplicates.ts";
import { pathInsideRoot } from "./roots.ts";
import { sourceMarkerOf, type SourceMarker } from "./source-marker.ts";

export type SnapshotFile = { path: string; content: Uint8Array };

export type LockArtifactInput = {
  version?: string;
  digest?: string;
  files?: Record<string, string>;
  runtime?: string;
};

export type LockInput =
  | {
      artifacts?: Record<string, LockArtifactInput | undefined>;
    }
  | null
  | undefined;

export type SnapshotItem = {
  key: string;
  type: string;
  name: string;
  digest: string;
  files: Array<{ path: string; sha256: string; size: number }>;
  version: string | null;
  root: string;
  /** True when digest/version came from a lock match on installed foreign files. */
  translated?: boolean;
  /** agent-source-marker: the registry artifact this file was built from, by its front matter. */
  source?: SourceMarker;
};

export type SnapshotInvalid = {
  root: string;
  errors: Array<{ code?: string; message?: string; path?: string; severity?: string }>;
};

export type SnapshotSkipped = { path: string; reason: string };

export type SnapshotResult = {
  /** One item per key; extra copies are described in `duplicates`. */
  items: SnapshotItem[];
  duplicates: DuplicateGroup[];
  skipped: SnapshotSkipped[];
  invalid: SnapshotInvalid[];
};

export type ScanServerDirOk = {
  ok: true;
  files: SnapshotFile[];
  lock: LockInput;
  /** Directories that were not read because their realpath is outside the scan root. */
  skipped: SnapshotSkipped[];
};

export type ScanServerDirOptions = {
  /**
   * The caller passes a path already resolved with realpath and checked against the agent roots
   * (checkServerPathAgainstRoots). If realpath(absPath) no longer equals it, a path component was
   * swapped after the check, and the scan is refused with path_outside_roots.
   */
  expectRealPath?: boolean;
};

export type ScanServerDirErr = {
  ok: false;
  error: string;
  message?: string;
};

const MAX_FILES = 2000;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

function sha256Hex(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Remap hooks/hooks.json -> hooks.json for parseHook input (same as import). */
function filesForParse(
  type: string,
  files: Array<{ path: string; content: string | Uint8Array }>,
): Array<{ path: string; content: string | Uint8Array }> {
  if (type !== "hook") return files;
  return files.map((f) =>
    f.path === "hooks/hooks.json" || f.path.endsWith("/hooks/hooks.json")
      ? { path: "hooks.json", content: f.content }
      : f,
  );
}

type FileIndex = Map<string, { sha256: string; size: number; content: Uint8Array }>;

function indexFiles(files: SnapshotFile[]): FileIndex {
  const map: FileIndex = new Map();
  for (const f of files) {
    map.set(f.path, {
      sha256: sha256Hex(f.content),
      size: f.content.byteLength,
      content: f.content,
    });
  }
  return map;
}

/**
 * Lock match: non-empty lock.artifacts[key].files and every listed path present in the snapshot
 * with the same sha256. Empty `files: {}` is never a match.
 */
function matchLockEntry(
  key: string,
  lock: LockInput,
  index: FileIndex,
): {
  digest: string;
  version: string | null;
  files: Array<{ path: string; sha256: string; size: number }>;
} | null {
  if (!lock || !lock.artifacts) return null;
  const entry = lock.artifacts[key];
  if (!entry || typeof entry !== "object") return null;
  const lockFiles = entry.files;
  if (!lockFiles || typeof lockFiles !== "object") return null;
  const paths = Object.keys(lockFiles);
  if (paths.length === 0) return null;
  if (typeof entry.digest !== "string") return null;

  const out: Array<{ path: string; sha256: string; size: number }> = [];
  for (const rel of paths) {
    const expected = lockFiles[rel];
    if (typeof expected !== "string") return null;
    const actual = index.get(rel);
    if (!actual || actual.sha256 !== expected) return null;
    out.push({ path: rel, sha256: actual.sha256, size: actual.size });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return {
    digest: entry.digest,
    version: typeof entry.version === "string" ? entry.version : null,
    files: out,
  };
}

/**
 * A candidate may take the lock path only when its key is `<type>/<name>` with a known artifact
 * type equal to the candidate type and a name that passes the parsers' name rule. Otherwise the
 * candidate goes through parseArtifact, which reports the parser error.
 */
function lockKeyValid(candidate: { id: string; type: string }): boolean {
  const slash = candidate.id.indexOf("/");
  if (slash === -1) return false;
  const type = candidate.id.slice(0, slash);
  const name = candidate.id.slice(slash + 1);
  return type === candidate.type && isArtifactType(type) && validateName(name);
}

/** Lock-matched installs are "translated" only when the lock runtime used a non-files method. */
function isTranslatedLock(entry: LockArtifactInput, type: string): boolean {
  const runtime = entry.runtime;
  if (typeof runtime !== "string" || !isRuntimeId(runtime)) return false;
  if (
    type !== "skill" &&
    type !== "command" &&
    type !== "agent" &&
    type !== "hook" &&
    type !== "plugin" &&
    type !== "settings"
  ) {
    return false;
  }
  const support = runtimeSupport(runtimeDef(runtime), type as ArtifactType);
  return support.supported && support.method !== "files";
}

function itemFromLockMatch(
  candidate: { id: string; type: string; nameHint: string; root: string },
  locked: {
    digest: string;
    version: string | null;
    files: Array<{ path: string; sha256: string; size: number }>;
  },
  lock: LockInput,
): SnapshotItem {
  const slash = candidate.id.indexOf("/");
  const type = slash === -1 ? candidate.type : candidate.id.slice(0, slash);
  const name = slash === -1 ? candidate.nameHint : candidate.id.slice(slash + 1);
  const lockEntry = lock?.artifacts?.[candidate.id];
  return {
    key: candidate.id,
    type,
    name,
    digest: locked.digest,
    files: locked.files,
    version: locked.version,
    root: candidate.root,
    ...(lockEntry && isTranslatedLock(lockEntry, type) ? { translated: true } : {}),
  };
}

function versionFromLock(lock: LockInput, key: string): string | null {
  const entry = lock?.artifacts?.[key];
  return entry && typeof entry.version === "string" ? entry.version : null;
}

function itemFromParse(
  candidate: {
    type: string;
    root: string;
    files: Array<{ path: string; content: string | Uint8Array }>;
  },
  lock: LockInput,
  dataDir: string | undefined,
): { item: SnapshotItem } | { invalid: SnapshotInvalid } {
  const prepared = filesForParse(candidate.type, candidate.files);
  const parsed = parseArtifact({ type: candidate.type, files: prepared });
  if (!parsed.ok) {
    return { invalid: { root: candidate.root, errors: parsed.errors } };
  }
  const artifact = parsed.artifact;
  const key = `${artifact.type}/${artifact.name}`;
  if (dataDir) {
    for (const can of artifact.canonical) {
      putBlob(dataDir, can.content);
    }
  }
  return {
    item: {
      key,
      type: artifact.type,
      name: artifact.name,
      digest: artifact.digest,
      files: artifact.files,
      version: versionFromLock(lock, key),
      root: candidate.root,
    },
  };
}

/**
 * Build an agent snapshot from an in-memory file list.
 * When dataDir is provided, writes blob contents for each canonical file (skipped on lock match).
 * Omit dataDir (viewer snapshots) to keep paths/hashes/sizes without storing content.
 */
export function buildSnapshot(
  files: SnapshotFile[],
  lock?: LockInput,
  dataDir?: string,
  runtime?: string | null,
): SnapshotResult {
  const scanned = scanImportTree(
    files.map((f) => ({ path: f.path, content: f.content })),
    { runtime: runtime ?? undefined },
  );
  const index = indexFiles(files);
  const items: SnapshotItem[] = [];
  const invalid: SnapshotInvalid[] = [...scanned.invalid];

  for (const c of scanned.candidates) {
    const locked = lockKeyValid(c) ? matchLockEntry(c.id, lock, index) : null;
    const source = sourceMarkerOf(c.type, c.files);
    const withSource = (item: SnapshotItem) => (source ? { ...item, source } : item);
    if (locked) {
      items.push(withSource(itemFromLockMatch(c, locked, lock)));
      continue;
    }
    const parsed = itemFromParse(c, lock, dataDir);
    if ("invalid" in parsed) {
      invalid.push(parsed.invalid);
      continue;
    }
    items.push(withSource(parsed.item));
  }

  const deduped = dedupeSnapshotItems(items);
  return {
    items: deduped.items,
    duplicates: deduped.duplicates,
    skipped: scanned.skipped.map((s) => ({ path: s.path, reason: s.reason })),
    invalid,
  };
}

/** Alias for `buildSnapshot`. */
export const snapshotFromFiles = buildSnapshot;

function shouldSkipDirName(name: string): boolean {
  return name === "node_modules" || name === ".git";
}

function samePath(a: string, b: string): boolean {
  return pathInsideRoot(a, b) && pathInsideRoot(b, a);
}

/** realpath of dir when it stays inside realRoot (case-insensitive on win32); null otherwise. */
function realDirInsideRoot(dir: string, realRoot: string): string | null {
  let realDir: string;
  try {
    realDir = fs.realpathSync(dir);
  } catch {
    return null;
  }
  return pathInsideRoot(realDir, realRoot) ? realDir : null;
}

/**
 * Recursively list files under absPath for a server agent scan.
 * Skips node_modules and .git; treats .skillforge-lock.json as lock (not a file).
 * The scan root is realpath(absPath). Before reading each directory its realpath must stay inside
 * the real root (case-insensitive on win32); a directory outside it is not read and is reported in
 * `skipped` with reason "outside_scan_root". Links inside the tree are never followed (Dirent).
 */
export function scanServerDir(
  absPath: string,
  options: ScanServerDirOptions = {},
): ScanServerDirOk | ScanServerDirErr {
  const requested = path.resolve(absPath);
  let root: string;
  try {
    if (!fs.statSync(requested).isDirectory()) {
      return { ok: false, error: "not_found" };
    }
    root = fs.realpathSync(requested);
  } catch {
    return { ok: false, error: "not_found" };
  }
  if (options.expectRealPath && !samePath(root, requested)) {
    return {
      ok: false,
      error: "path_outside_roots",
      message: "agent path changed after the roots check",
    };
  }

  const files: SnapshotFile[] = [];
  const skipped: SnapshotSkipped[] = [];
  let lock: LockInput = null;
  let totalBytes = 0;

  /** A directory that still exists but resolves outside the real root is skipped with a reason. */
  function noteOutsideRoot(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const rel = path.relative(root, dir).split(path.sep).join("/");
    skipped.push({ path: rel, reason: "outside_scan_root" });
  }

  function walk(dir: string): string | null {
    const realDir = realDirInsideRoot(dir, root);
    if (!realDir) {
      noteOutsideRoot(dir);
      return null;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(realDir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const ent of entries) {
      const abs = path.join(realDir, ent.name);
      if (ent.isDirectory()) {
        if (shouldSkipDirName(ent.name)) continue;
        const err = walk(abs);
        if (err) return err;
        continue;
      }
      if (!ent.isFile()) continue;
      if (ent.name === ".skillforge-lock.json") {
        try {
          const raw = fs.readFileSync(abs, "utf8");
          const parsed = JSON.parse(raw) as LockInput;
          lock = parsed && typeof parsed === "object" ? parsed : null;
        } catch {
          lock = null;
        }
        continue;
      }
      const st = fs.statSync(abs);
      if (st.size > MAX_FILE_BYTES) {
        return "file_too_large";
      }
      totalBytes += st.size;
      if (files.length + 1 > MAX_FILES) {
        return "too_many_files";
      }
      if (totalBytes > MAX_TOTAL_BYTES) {
        return "too_many_files";
      }
      const rel = path.relative(root, abs).split(path.sep).join("/");
      files.push({ path: rel, content: new Uint8Array(fs.readFileSync(abs)) });
    }
    return null;
  }

  const err = walk(root);
  if (err === "too_many_files") {
    return { ok: false, error: "too_many_files", message: "agent directory exceeds file limits" };
  }
  if (err === "file_too_large") {
    return { ok: false, error: "too_many_files", message: "file exceeds 16 MiB" };
  }
  return { ok: true, files, lock, skipped };
}

export const AGENT_SCAN_LIMITS = {
  maxFiles: MAX_FILES,
  maxTotalBytes: MAX_TOTAL_BYTES,
  maxFileBytes: MAX_FILE_BYTES,
};
