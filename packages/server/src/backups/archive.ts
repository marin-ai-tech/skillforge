import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import {
  TAR_END_BYTES,
  buildTarHeader,
  compareTarPaths,
  normalizeTarPath,
  tarPadding,
} from "../distribution/tar.ts";

export type BackupCounts = {
  users: number;
  artifacts: number;
  versions: number;
  blobs: number;
};

export type BackupManifest = {
  format: 1;
  created_at: string;
  server_version: string;
  migrations: number;
  /** backup-signing-key: key_id of the signing key in the archive, null when there is none. */
  signing_key_id: string | null;
  counts: BackupCounts;
};

/** A blob file to archive: tar path under `blobs/…`, absolute file path, size at collection time. */
export type BlobFileEntry = {
  path: string;
  file: string;
  size: number;
};

/** One archive member whose content is produced lazily, chunk by chunk. */
type ArchiveSource = {
  path: string;
  size: number;
  chunks: () => AsyncIterable<Uint8Array>;
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively list the regular files under `<dataDir>/<sub>` (asynchronously, without reading them) as entries with
 * tar paths relative to the data directory. Links and other special files are skipped.
 */
async function collectFiles(dataDir: string, sub: string): Promise<BlobFileEntry[]> {
  const root = path.join(dataDir, sub);
  const entries: BlobFileEntry[] = [];
  if (!(await pathExists(root))) return entries;

  const walk = async (dir: string, relPosix: string): Promise<void> => {
    for (const name of await fs.promises.readdir(dir)) {
      const full = path.join(dir, name);
      const rel = relPosix ? `${relPosix}/${name}` : name;
      const st = await fs.promises.lstat(full);
      if (st.isDirectory()) {
        await walk(full, rel);
      } else if (st.isFile()) {
        entries.push({ path: rel, file: full, size: st.size });
      }
    }
  };

  await walk(root, sub.split(path.sep).join("/"));
  return entries;
}

/** Blob files as entries under `blobs/…`. */
export function collectBlobEntries(dataDir: string): Promise<BlobFileEntry[]> {
  return collectFiles(dataDir, "blobs");
}

/** The signing key file relative to the data directory (release-signing). */
export const SIGNING_KEY_PATH = path.join("signing", "ed25519.pem");

/**
 * backup-signing-key: the signing key and the plugins directory, when it lies inside the data directory, so that a
 * restore into an empty directory brings back the same key and the same plugins.
 */
export async function collectExtraEntries(
  dataDir: string,
  pluginsDir?: string,
): Promise<BlobFileEntry[]> {
  const entries: BlobFileEntry[] = [];
  const key = path.join(dataDir, SIGNING_KEY_PATH);
  const keyStat = await fs.promises.lstat(key).catch(() => null);
  if (keyStat?.isFile())
    entries.push({ path: "signing/ed25519.pem", file: key, size: keyStat.size });
  if (pluginsDir) {
    const rel = path.relative(dataDir, pluginsDir);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel))
      entries.push(...(await collectFiles(dataDir, rel)));
  }
  return entries;
}

export function buildManifest(args: {
  createdAt: string;
  serverVersion: string;
  migrations: number;
  signingKeyId: string | null;
  counts: BackupCounts;
}): BackupManifest {
  return {
    format: 1,
    created_at: args.createdAt,
    server_version: args.serverVersion,
    migrations: args.migrations,
    signing_key_id: args.signingKeyId,
    counts: args.counts,
  };
}

/** Stream exactly `size` bytes of `file`; fail if the file no longer matches its header size. */
async function* fileChunks(file: string, size: number): AsyncGenerator<Uint8Array> {
  let read = 0;
  if (size > 0) {
    for await (const chunk of fs.createReadStream(file, { start: 0, end: size - 1 })) {
      const bytes = chunk as Buffer;
      read += bytes.byteLength;
      yield bytes;
    }
  }
  if (read !== size) {
    throw new Error(`backup: ${file} changed while archiving (${read} of ${size} bytes)`);
  }
}

async function* bytesChunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

/** ustar byte stream: header, content, padding per member, then the end-of-archive blocks. */
async function* tarStream(sources: ArchiveSource[]): AsyncGenerator<Uint8Array> {
  for (const src of sources) {
    yield buildTarHeader(src.path, src.size);
    yield* src.chunks();
    const pad = tarPadding(src.size);
    if (pad > 0) yield new Uint8Array(pad);
  }
  yield new Uint8Array(TAR_END_BYTES);
}

/**
 * Stream skillforge.db + manifest.json + blobs (+ signing key and plugins) into a deterministic tar.gz at `destPath`
 * (same layout and entry order as `buildTarGz`). Files are read with streams; nothing is
 * buffered whole. On error every stream is destroyed; the caller removes `destPath`.
 */
export async function writeBackupArchive(args: {
  dbPath: string;
  manifest: BackupManifest;
  blobEntries: BlobFileEntry[];
  /** backup-signing-key: the signing key and plugin files. */
  extraEntries?: BlobFileEntry[];
  destPath: string;
}): Promise<void> {
  const manifestJson = new TextEncoder().encode(`${JSON.stringify(args.manifest, null, 2)}\n`);
  const dbSize = (await fs.promises.stat(args.dbPath)).size;
  const sources: ArchiveSource[] = [
    { path: "skillforge.db", size: dbSize, chunks: () => fileChunks(args.dbPath, dbSize) },
    {
      path: "manifest.json",
      size: manifestJson.byteLength,
      chunks: () => bytesChunks(manifestJson),
    },
    ...[...args.blobEntries, ...(args.extraEntries ?? [])].map((b) => ({
      path: normalizeTarPath(b.path),
      size: b.size,
      chunks: () => fileChunks(b.file, b.size),
    })),
  ];
  sources.sort((a, b) => compareTarPaths(a.path, b.path));
  await pipeline(
    Readable.from(tarStream(sources), { objectMode: false }),
    createGzip({ level: 6 }),
    // The archive holds the private signing key: readable by the owner only (backup-signing-key).
    fs.createWriteStream(args.destPath, { flags: "wx", mode: 0o600 }),
  );
}
