import { gunzipSync } from "node:zlib";

/**
 * GitHub archive transport (tracked-sources): the head commit of a branch or tag and the tarball of a commit through
 * the REST API at SKILLFORGE_GITHUB_API_URL — no git needed on the server. The token, when set, goes only to that
 * address. The archive is untrusted input: entries are parsed here, with the import limits and the path check.
 */
export type GithubRepo = { owner: string; repo: string };
export type SourceFile = { path: string; content: Buffer };

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 1000;
const MAX_FILES_BYTES = 32 * 1024 * 1024;
const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

export class SourceFetchError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** `https://github.com/<owner>/<repo>` (optionally `.git`) → owner and repo; anything else → null. */
export function githubRepoOf(url: string): GithubRepo | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== "github.com" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    return null;
  const [owner, repo, ...rest] = u.pathname
    .replace(/^\/|\/$/g, "")
    .replace(/\.git$/, "")
    .split("/");
  if (!owner || !repo || rest.length > 0 || !NAME_RE.test(owner) || !NAME_RE.test(repo))
    return null;
  return { owner, repo };
}

function headers(token: string | null): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "skillforge-tracked-sources",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export async function githubCommit(
  api: string,
  token: string | null,
  repo: GithubRepo,
  ref: string | null,
): Promise<string> {
  const res = await fetch(
    `${api}/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(ref ?? "HEAD")}`,
    { headers: headers(token), signal: AbortSignal.timeout(30_000) },
  ).catch(() => null);
  if (!res?.ok)
    throw new SourceFetchError(res?.status === 404 ? "ref_not_found" : "github_unreachable");
  const sha = ((await res.json()) as { sha?: unknown }).sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha))
    throw new SourceFetchError("github_bad_answer");
  return sha;
}

function field(block: Buffer, start: number, length: number): string {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? raw.length : end).toString("utf8");
}

/** A path inside the archive's top folder: relative, no `..`, no empty segment. */
function insidePath(name: string): string | null {
  const parts = name.split("/").filter((p, i, all) => !(p === "" && i === all.length - 1));
  if (parts.length < 2 || parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return parts.slice(1).join("/");
}

/** pax `path=` record, if any. */
function paxPath(data: Buffer): string | null {
  const m = /\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
  return m ? m[1]! : null;
}

type Header = { size: number; type: string; name: string };

/** One ustar header block: entry size, type flag (a NUL flag is a regular file) and name with its prefix. */
function header(block: Buffer): Header {
  const size = parseInt(field(block, 124, 12).trim() || "0", 8);
  if (!Number.isFinite(size) || size < 0) throw new SourceFetchError("archive_broken");
  const prefix = field(block, 345, 155);
  const name = field(block, 0, 100);
  return {
    size,
    type: String.fromCharCode(block[156] || 48),
    name: prefix ? `${prefix}/${name}` : name,
  };
}

/** A regular file entry as a file of the folder; directories are skipped, every other entry type is refused. */
function fileOf(h: Header, name: string, data: Buffer): SourceFile | null {
  if (h.type === "5") return null;
  if (h.type !== "0") throw new SourceFetchError("archive_unsafe_entry");
  const rel = insidePath(name);
  if (rel === null) throw new SourceFetchError("archive_unsafe_path");
  return { path: rel, content: Buffer.from(data) };
}

/** Regular files of a ustar/pax tarball, top folder stripped. Throws on an unsafe path or a broken archive. */
export function untarFiles(gz: Buffer): SourceFile[] {
  const tar = gunzipSync(gz, { maxOutputLength: MAX_ARCHIVE_BYTES });
  const files: SourceFile[] = [];
  let pending: string | null = null;
  let total = 0;
  for (let off = 0; off + 512 <= tar.length;) {
    const block = tar.subarray(off, off + 512);
    if (block.every((b) => b === 0)) break;
    const h = header(block);
    const data = tar.subarray(off + 512, off + 512 + h.size);
    off += 512 + Math.ceil(h.size / 512) * 512;
    if (h.type === "x") pending = paxPath(data);
    if (h.type === "x" || h.type === "g") continue;
    const file = fileOf(h, pending ?? h.name, data);
    pending = null;
    if (!file) continue;
    total += h.size;
    if (files.length >= MAX_FILES || total > MAX_FILES_BYTES)
      throw new SourceFetchError("archive_too_large");
    files.push(file);
  }
  return files;
}

/** Files under `path` of a commit, relative to that folder. */
export async function githubFolder(
  api: string,
  token: string | null,
  repo: GithubRepo,
  sha: string,
  path: string,
): Promise<SourceFile[]> {
  const res = await fetch(`${api}/repos/${repo.owner}/${repo.repo}/tarball/${sha}`, {
    headers: headers(token),
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  }).catch(() => null);
  if (!res?.ok) throw new SourceFetchError("github_unreachable");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_ARCHIVE_BYTES) throw new SourceFetchError("archive_too_large");
  const prefix = path ? `${path.replace(/\/$/, "")}/` : "";
  return untarFiles(buf)
    .filter((f) => f.path.startsWith(prefix))
    .map((f) => ({ path: f.path.slice(prefix.length), content: f.content }));
}
