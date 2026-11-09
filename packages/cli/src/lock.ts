import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseVersionSpec } from "@skillforge/core";
import { assertSafeRelPath, relativeInside } from "./bundle.ts";

export type LockArtifact = {
  version: string;
  digest: string;
  files: Record<string, string>;
  installed_at: string;
  /** Runtime of the latest install (absent for `--into` installs and older locks). */
  runtime?: string;
  /** Version spec that `install`/`sync`/`outdated` resolve instead of `latest`. */
  pin?: string;
  /** artifact-overlays: fingerprint of the layers applied; a change reinstalls the same version. */
  overlays?: string;
};

export type LockFile = {
  registry: string;
  artifacts: Record<string, LockArtifact>;
};

export class LockError extends Error {
  readonly lockPath: string;
  readonly rel: string;

  constructor(lockPath: string, rel: string) {
    super(`corrupt lock file ${lockPath}: unsafe path "${rel}"`);
    this.name = "LockError";
    this.lockPath = lockPath;
    this.rel = rel;
  }
}

export function lockPathFor(intoDir: string): string {
  return path.join(intoDir, ".skillforge-lock.json");
}

export function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Drops pins that are not valid version specs; the entry is then treated as unpinned. */
function dropInvalidPins(
  artifacts: Record<string, LockArtifact>,
  onInvalidPin: ((key: string) => void) | undefined,
): Record<string, LockArtifact> {
  const out: Record<string, LockArtifact> = {};
  for (const [key, entry] of Object.entries(artifacts)) {
    if (entry && typeof entry === "object" && "pin" in entry) {
      const { pin, ...rest } = entry;
      if (parseVersionSpec(pin) === null) {
        onInvalidPin?.(key);
        out[key] = rest;
        continue;
      }
    }
    out[key] = entry;
  }
  return out;
}

export function readLock(intoDir: string, onInvalidPin?: (key: string) => void): LockFile {
  const p = lockPathFor(intoDir);
  if (!fs.existsSync(p)) {
    return { registry: "", artifacts: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as LockFile;
    if (!parsed || typeof parsed !== "object") return { registry: "", artifacts: {} };
    return {
      registry: typeof parsed.registry === "string" ? parsed.registry : "",
      artifacts:
        parsed.artifacts && typeof parsed.artifacts === "object"
          ? dropInvalidPins(parsed.artifacts, onInvalidPin)
          : {},
    };
  } catch {
    return { registry: "", artifacts: {} };
  }
}

export function invalidPinWarning(key: string): string {
  return `warning: ignored invalid pin for ${key}`;
}

export function writeLock(intoDir: string, lock: LockFile): void {
  fs.mkdirSync(intoDir, { recursive: true });
  const dest = lockPathFor(intoDir);
  const tmp = path.join(intoDir, `.skillforge-lock.json.tmp.${process.pid}.${Date.now()}`);
  const body = `${JSON.stringify(lock, null, 2)}\n`;
  fs.writeFileSync(tmp, body, "utf8");
  try {
    fs.renameSync(tmp, dest);
  } catch {
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch {
      // ignore
    }
    fs.renameSync(tmp, dest);
  }
}

/**
 * Validate every relative path in a lock entry stays inside `into`.
 * Throws LockError before any caller performs fs ops on those paths.
 */
export function safeLockPaths(entry: LockArtifact, into: string): string[] {
  const lockPath = lockPathFor(into);
  const absPaths: string[] = [];
  for (const rel of Object.keys(entry.files)) {
    try {
      absPaths.push(assertSafeRelPath(rel, into));
    } catch {
      throw new LockError(lockPath, rel);
    }
  }
  return absPaths;
}

export function pruneEmptyDirs(fileAbs: string, intoAbs: string): void {
  let dir = path.dirname(path.resolve(fileAbs));
  const root = path.resolve(intoAbs);
  for (let rel = relativeInside(root, dir); rel; rel = relativeInside(root, dir)) {
    try {
      const entries = fs.readdirSync(dir);
      if (entries.length > 0) break;
      fs.rmdirSync(dir);
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
}
