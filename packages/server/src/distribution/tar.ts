import { gzipSync } from "node:zlib";

export type TarEntry = {
  path: string;
  content: Uint8Array;
  mode?: number;
};

/** Size of the two zero blocks that terminate a ustar archive. */
export const TAR_END_BYTES = 1024;

function octal(n: number, width: number): string {
  const s = n.toString(8);
  if (s.length > width - 1) {
    throw new Error(`octal field overflow: ${n} needs >${width - 1} digits`);
  }
  return s.padStart(width - 1, "0") + "\0";
}

function splitName(filePath: string): { name: string; prefix: string } {
  const normalized = filePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (normalized.length <= 100) {
    return { name: normalized, prefix: "" };
  }
  for (let i = normalized.length - 100 - 1; i >= 0; i--) {
    if (normalized.charAt(i) === "/") {
      const prefix = normalized.slice(0, i);
      const name = normalized.slice(i + 1);
      if (prefix.length <= 155 && name.length <= 100 && name.length > 0) {
        return { name, prefix };
      }
    }
  }
  throw new Error(`path too long for ustar: ${normalized}`);
}

function defaultMode(filePath: string, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized === "scripts" || normalized.startsWith("scripts/")) {
    return 0o755;
  }
  return 0o644;
}

/** Archive path as stored in the header: forward slashes, no leading slash. */
export function normalizeTarPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Entry order used by every archive writer (deterministic, by path). */
export function compareTarPaths(a: string, b: string): number {
  return a.replace(/\\/g, "/").localeCompare(b.replace(/\\/g, "/"));
}

/** Zero padding after `size` content bytes up to the next 512-byte block. */
export function tarPadding(size: number): number {
  return (512 - (size % 512)) % 512;
}

/** ustar header block for a regular file of `size` bytes. */
export function buildTarHeader(filePath: string, size: number, explicitMode?: number): Uint8Array {
  const header = new Uint8Array(512);
  const { name, prefix } = splitName(filePath);
  const mode = defaultMode(filePath, explicitMode);

  const put = (offset: number, value: string, max: number) => {
    const bytes = Buffer.from(value, "utf8");
    const n = Math.min(bytes.length, max);
    header.set(bytes.subarray(0, n), offset);
  };

  put(0, name, 100);
  put(100, octal(mode, 8), 8);
  put(108, octal(0, 8), 8);
  put(116, octal(0, 8), 8);
  put(124, octal(size, 12), 12);
  put(136, octal(0, 12), 12);
  for (let i = 0; i < 8; i++) header[148 + i] = 0x20;
  header[156] = 0x30;
  put(257, "ustar\0", 6);
  put(263, "00", 2);
  put(345, prefix, 155);

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i]!;
  const checksum = sum.toString(8).padStart(6, "0") + "\0 ";
  put(148, checksum, 8);

  return header;
}

/** Deterministic ustar + gzip (level 6). Entries sorted by path. */
export function buildTarGz(entries: TarEntry[]): Uint8Array {
  const sorted = entries.slice().sort((a, b) => compareTarPaths(a.path, b.path));

  const parts: Uint8Array[] = [];
  for (const entry of sorted) {
    const entryPath = normalizeTarPath(entry.path);
    parts.push(buildTarHeader(entryPath, entry.content.byteLength, entry.mode));
    parts.push(entry.content);
    const pad = tarPadding(entry.content.byteLength);
    if (pad > 0) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(TAR_END_BYTES));

  let total = 0;
  for (const p of parts) total += p.byteLength;
  const tar = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    tar.set(p, offset);
    offset += p.byteLength;
  }

  const gz = gzipSync(Buffer.from(tar), { level: 6 });
  gz[4] = 0;
  gz[5] = 0;
  gz[6] = 0;
  gz[7] = 0;
  return new Uint8Array(gz);
}
