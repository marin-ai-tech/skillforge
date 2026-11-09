import { createHash } from "node:crypto";

export function sha256Hex(data: Uint8Array | string): string {
  const hash = createHash("sha256");
  hash.update(typeof data === "string" ? Buffer.from(data, "utf8") : data);
  return hash.digest("hex");
}

export function compareUtf8Paths(a: string, b: string): number {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  const len = Math.min(ba.length, bb.length);
  for (let i = 0; i < len; i++) {
    const d = ba[i]! - bb[i]!;
    if (d !== 0) return d;
  }
  return ba.length - bb.length;
}

export function bundleDigest(files: Array<{ path: string; sha256: string }>): string {
  if (files.length === 0) {
    return sha256Hex("");
  }
  const sorted = [...files].sort((x, y) => compareUtf8Paths(x.path, y.path));
  let record = "";
  for (const f of sorted) {
    record += `${f.path}\0${f.sha256}\n`;
  }
  return sha256Hex(record);
}
