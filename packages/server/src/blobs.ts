import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { sha256Hex } from "@skillforge/core";

export function blobPath(dataDir: string, sha: string): string {
  return path.join(dataDir, "blobs", sha.slice(0, 2), sha);
}

export function hasBlob(dataDir: string, sha: string): boolean {
  return fs.existsSync(blobPath(dataDir, sha));
}

/**
 * Blob integrity: the name of a blob is the sha256 of its content, so a blob whose content no longer
 * matches is damaged. It is never handed out; the HTTP layer answers 500 blob_corrupt.
 */
export class BlobCorruptError extends Error {
  readonly sha: string;
  constructor(sha: string) {
    super(`blob ${sha} does not match its hash`);
    this.name = "BlobCorruptError";
    this.sha = sha;
  }
}

export function readBlob(dataDir: string, sha: string): Uint8Array {
  const content = new Uint8Array(fs.readFileSync(blobPath(dataDir, sha)));
  if (sha256Hex(content) !== sha) throw new BlobCorruptError(sha);
  return content;
}

/** An existing blob counts only if it is intact: a damaged one is replaced, so publishing the file repairs it. */
function intact(target: string, sha: string): boolean {
  try {
    return sha256Hex(new Uint8Array(fs.readFileSync(target))) === sha;
  } catch {
    return false;
  }
}

export function putBlob(dataDir: string, content: Uint8Array): string {
  const sha = sha256Hex(content);
  const target = blobPath(dataDir, sha);
  if (fs.existsSync(target) && intact(target, sha)) {
    return sha;
  }
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
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
    if (fs.existsSync(target) && intact(target, sha)) {
      return sha;
    }
    throw e;
  }
  return sha;
}
