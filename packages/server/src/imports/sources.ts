import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import type { AppConfig } from "../config.ts";
import { decodeBase64Strict } from "../lib/base64.ts";
import { isSourceAllowed, parseGitLocation, type ImportPolicy } from "./policy.ts";

const execFileAsync = promisify(execFile);

export const IMPORT_MAX_BYTES = 64 * 1024 * 1024;
export const IMPORT_MAX_FILES = 5000;

export type ImportSourceFiles = {
  kind: "files";
  files: Array<{ path: string; content_base64: string }>;
};
export type ImportSourceZip = { kind: "zip"; content_base64: string };
export type ImportSourceGit = { kind: "git"; url: string; ref?: string; path?: string };
export type ImportSource = ImportSourceFiles | ImportSourceZip | ImportSourceGit;

export type MaterializedFile = { path: string; content: Uint8Array };

export type MaterializeOk = {
  ok: true;
  files: MaterializedFile[];
  ref: string;
  kind: "files" | "zip" | "git";
  /** Git only: the cloned commit and the address it came from, parsed. */
  git?: { url: string; location_key: string; commit: string };
  cleanup: () => void;
};

export type MaterializeErr = {
  ok: false;
  error: string;
  message?: string;
  status?: number;
};

export type MaterializeResult = MaterializeOk | MaterializeErr;

/** Strip credentials from URLs for logs, errors, and source.ref. */
export function stripUserinfo(url: string): string {
  try {
    if (url.startsWith("git@")) return url;
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      return u.toString();
    }
    return url;
  } catch {
    return url.replace(/\/\/[^/@]+@/g, "//***@");
  }
}

function redactMessage(msg: string, url: string): string {
  let out = msg;
  const secret = (() => {
    try {
      const u = new URL(url);
      return u.password || u.username || "";
    } catch {
      const m = /\/\/([^/@]+)@/.exec(url);
      return m?.[1] ?? "";
    }
  })();
  if (secret) out = out.split(secret).join("***");
  // Also redact user:pass@ patterns generally
  out = out.replace(/\/\/[^/\s]+@/g, "//***@");
  return out;
}

export function isGitUrlAllowed(
  url: string,
  opts: { allowFileUrls: boolean },
): { ok: true } | { ok: false; error: "import_url_not_allowed" } {
  const trimmed = url.trim();
  if (trimmed.startsWith("git@") && trimmed.includes(":")) return { ok: true };
  if (trimmed.startsWith("ssh://")) return { ok: true };
  if (trimmed.startsWith("https://")) return { ok: true };
  if (trimmed.startsWith("file:") || isLocalPath(trimmed)) {
    if (opts.allowFileUrls) return { ok: true };
    return { ok: false, error: "import_url_not_allowed" };
  }
  return { ok: false, error: "import_url_not_allowed" };
}

function isLocalPath(url: string): boolean {
  if (url.startsWith("/") || url.startsWith("./") || url.startsWith("../")) return true;
  if (/^[A-Za-z]:[\\/]/.test(url)) return true;
  return false;
}

/** Max length for git (and analogous) relative import path. */
export const IMPORT_PATH_MAX = 200;

/** Safe git ref: no leading dash, no spaces/semicolons; alphanumeric start. */
export const IMPORT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

/**
 * Relative import path: 1..200 chars, no `..`, no leading `/`, no drive letter, no backslash.
 * Schema-level check; pair with resolveUnderRoot after joining with cloneDir.
 */
export function isSafeImportPath(p: string): boolean {
  if (typeof p !== "string") return false;
  if (p.length < 1 || p.length > IMPORT_PATH_MAX) return false;
  if (p.startsWith("/") || p.includes("\\") || p.includes("\0")) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  const segs = p.split("/");
  for (const seg of segs) {
    if (seg === ".." || seg === "") return false;
  }
  return true;
}

/** Git ref safe for --branch argv (must match IMPORT_REF_RE). */
export function isSafeImportRef(ref: string): boolean {
  return typeof ref === "string" && IMPORT_REF_RE.test(ref);
}

/**
 * Resolve `rel` under `root`. Lexical containment first, then realpath of the
 * nearest existing ancestor must lie under realpath(root). Catches directory
 * symlinks/junctions that escape the clone, plus residual `..` escapes.
 */
export function resolveUnderRoot(
  root: string,
  rel: string,
): { ok: true; resolved: string } | { ok: false } {
  const resolved = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved) {
    const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
    if (!resolved.startsWith(prefix)) return { ok: false };
  }

  let probe = resolved;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }

  let rootReal: string;
  let probeReal: string;
  try {
    rootReal = fs.realpathSync(rootResolved);
    probeReal = fs.realpathSync(probe);
  } catch {
    return { ok: false };
  }

  const a = process.platform === "win32" ? rootReal.toLowerCase() : rootReal;
  const b = process.platform === "win32" ? probeReal.toLowerCase() : probeReal;
  if (b === a) return { ok: true, resolved };
  const realPrefix = a.endsWith(path.sep) ? a : a + path.sep;
  if (!b.startsWith(realPrefix)) return { ok: false };
  return { ok: true, resolved };
}

function normalizeZipPath(raw: string): { ok: true; path: string } | { ok: false } {
  if (raw.includes("\\")) return { ok: false };
  let p = raw.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  if (p.startsWith("/")) return { ok: false };
  if (/^[A-Za-z]:/.test(p)) return { ok: false };
  const segs = p.split("/");
  for (const seg of segs) {
    if (seg === ".." || seg === "") return { ok: false };
  }
  if (p.length === 0) return { ok: false };
  return { ok: true, path: p };
}

/** Strip a single common top-level directory (like prepareFiles / parseArtifact). */
export function stripCommonRoot(files: MaterializedFile[]): MaterializedFile[] {
  if (files.length === 0) return files;
  const tops = files.map((f) => {
    const i = f.path.indexOf("/");
    return i === -1 ? null : f.path.slice(0, i);
  });
  if (tops.some((t) => t === null)) return files;
  const root = tops[0]!;
  if (!tops.every((t) => t === root)) return files;
  const prefix = root + "/";
  return files.map((f) => ({
    ...f,
    path: f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path,
  }));
}

function materializeFiles(source: ImportSourceFiles): MaterializeResult {
  const files: MaterializedFile[] = [];
  let total = 0;
  for (const entry of source.files) {
    if (typeof entry.path !== "string" || typeof entry.content_base64 !== "string") {
      return { ok: false, error: "bad_request", message: "invalid file entry" };
    }
    const norm = normalizeZipPath(entry.path.replace(/\\/g, "/"));
    if (!norm.ok) return { ok: false, error: "import_unsafe_path" };
    const content = decodeBase64Strict(entry.content_base64);
    if (content === null) {
      return { ok: false, error: "bad_request", message: `invalid base64 for ${entry.path}` };
    }
    total += content.byteLength;
    if (total > IMPORT_MAX_BYTES || files.length + 1 > IMPORT_MAX_FILES) {
      return { ok: false, error: "import_too_large" };
    }
    files.push({ path: norm.path, content });
  }
  if (files.length === 0) {
    return { ok: false, error: "bad_request", message: "files must be non-empty" };
  }
  return {
    ok: true,
    files: stripCommonRoot(files),
    ref: "files",
    kind: "files",
    cleanup: () => {},
  };
}

function materializeZip(source: ImportSourceZip): MaterializeResult {
  const raw = decodeBase64Strict(source.content_base64);
  if (raw === null) return { ok: false, error: "bad_request", message: "invalid base64 for zip" };
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(raw);
  } catch {
    return { ok: false, error: "bad_request", message: "invalid zip" };
  }
  const files: MaterializedFile[] = [];
  let total = 0;
  for (const [name, data] of Object.entries(unzipped)) {
    // skip directory markers
    if (name.endsWith("/")) continue;
    const norm = normalizeZipPath(name);
    if (!norm.ok) return { ok: false, error: "import_unsafe_path" };
    total += data.byteLength;
    if (total > IMPORT_MAX_BYTES || files.length + 1 > IMPORT_MAX_FILES) {
      return { ok: false, error: "import_too_large" };
    }
    files.push({ path: norm.path, content: data });
  }
  if (files.length === 0) {
    return { ok: false, error: "bad_request", message: "empty zip" };
  }
  return {
    ok: true,
    files: stripCommonRoot(files),
    ref: "zip",
    kind: "zip",
    cleanup: () => {},
  };
}

type MaterializeFail = Extract<MaterializeResult, { ok: false }>;

function checkGitSource(
  source: ImportSourceGit,
  config: AppConfig,
  policy: ImportPolicy,
): MaterializeFail | null {
  if (!config.importGit) {
    return { ok: false, error: "import_git_disabled" };
  }
  const allowed = isGitUrlAllowed(source.url, { allowFileUrls: config.importAllowFileUrls });
  if (!allowed.ok) return allowed;
  if (!isSourceAllowed(policy, source.url)) {
    return { ok: false, error: "import_source_not_allowed", status: 403 };
  }

  if (source.ref !== undefined && !isSafeImportRef(source.ref)) {
    return { ok: false, error: "bad_request", message: "invalid ref" };
  }
  if (source.path !== undefined && !isSafeImportPath(source.path)) {
    return { ok: false, error: "bad_request", message: "invalid path" };
  }
  return null;
}

function cloneFailure(e: unknown, url: string): MaterializeFail {
  const msg = e instanceof Error ? e.message : String(e);
  const stderr =
    e && typeof e === "object" && "stderr" in e ? String((e as { stderr: unknown }).stderr) : "";
  const combined = redactMessage(`${msg} ${stderr}`.trim(), url);
  return { ok: false, error: "import_git_failed", message: combined || "git clone failed" };
}

async function headCommit(cloneDir: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: cloneDir,
    windowsHide: true,
  });
  return stdout.trim();
}

async function shallowClone(
  source: ImportSourceGit,
  cloneDir: string,
  followRedirects: boolean,
): Promise<MaterializeFail | null> {
  // With an allowlist a permitted host must not be able to send the clone somewhere else.
  const args = followRedirects ? [] : ["-c", "http.followRedirects=false"];
  args.push("clone", "--depth", "1");
  if (source.ref) {
    args.push("--branch", source.ref);
  }
  // Pass URL and directory after -- so neither is treated as a git option.
  args.push("--", source.url, cloneDir);

  try {
    await execFileAsync("git", args, {
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e) {
    return cloneFailure(e, source.url);
  }
  return null;
}

/** Directory to walk: the clone itself or source.path inside it (must stay under the clone). */
function resolveWalkRoot(
  cloneDir: string,
  source: ImportSourceGit,
): { walkRoot: string } | MaterializeFail {
  let walkRoot = cloneDir;
  if (source.path) {
    const nested = resolveUnderRoot(cloneDir, source.path);
    if (!nested.ok) {
      return { ok: false, error: "bad_request", message: "path escapes clone directory" };
    }
    walkRoot = nested.resolved;
  }
  if (!fs.existsSync(walkRoot)) {
    return { ok: false, error: "import_git_failed", message: "path not found in repository" };
  }
  return { walkRoot };
}

async function materializeGit(
  source: ImportSourceGit,
  config: AppConfig,
  workRoot: string,
  policy: ImportPolicy,
): Promise<MaterializeResult> {
  const invalid = checkGitSource(source, config, policy);
  if (invalid) return invalid;

  const cloneDir = path.join(workRoot, "clone");
  fs.mkdirSync(workRoot, { recursive: true });
  const cloneError = await shallowClone(source, cloneDir, policy.git_mode === "open");
  if (cloneError) return cloneError;
  const commit = await headCommit(cloneDir);

  const root = resolveWalkRoot(cloneDir, source);
  if (!("walkRoot" in root)) return root;
  const walkRoot = root.walkRoot;

  const files: MaterializedFile[] = [];
  let total = 0;

  function walk(dir: string, relBase: string) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === ".git") continue;
      const full = path.join(dir, ent.name);
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === "dist") continue;
        walk(full, rel);
      } else if (ent.isFile()) {
        const content = new Uint8Array(fs.readFileSync(full));
        total += content.byteLength;
        if (total > IMPORT_MAX_BYTES || files.length + 1 > IMPORT_MAX_FILES) {
          throw Object.assign(new Error("too large"), { code: "import_too_large" });
        }
        files.push({ path: rel.replace(/\\/g, "/"), content });
      }
    }
  }

  try {
    walk(walkRoot, "");
  } catch (e) {
    if (e && typeof e === "object" && (e as { code?: string }).code === "import_too_large") {
      return { ok: false, error: "import_too_large" };
    }
    throw e;
  }

  const safeRef = stripUserinfo(source.url);
  return {
    ok: true,
    files: stripCommonRoot(files),
    ref: safeRef,
    kind: "git",
    git: {
      url: source.url,
      // checkGitSource accepted the address, but an open policy does not parse it: unusual forms still get a key.
      location_key: parseGitLocation(source.url)?.key ?? safeRef,
      commit,
    },
    cleanup: () => {
      try {
        fs.rmSync(workRoot, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

export async function materialize(
  source: ImportSource,
  config: AppConfig,
  workRoot: string,
  policy: ImportPolicy,
): Promise<MaterializeResult> {
  if (source.kind === "files") return materializeFiles(source);
  if (source.kind === "zip") return materializeZip(source);
  if (source.kind === "git") return materializeGit(source, config, workRoot, policy);
  return { ok: false, error: "bad_request", message: "unknown source kind" };
}
