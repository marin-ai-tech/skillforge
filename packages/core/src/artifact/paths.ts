import { ISSUE_CODES, LIMITS } from "./types.ts";
import type { ArtifactFileInput, Issue } from "./types.ts";

export type NormalizedFile = {
  path: string;
  content: string | Uint8Array;
  size: number;
};

const encoder = new TextEncoder();

export function contentSize(content: string | Uint8Array): number {
  return typeof content === "string" ? encoder.encode(content).byteLength : content.byteLength;
}

export function toUint8Array(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? encoder.encode(content) : content;
}

type PathFail = {
  ok: false;
  code: "E_PATH_UNSAFE" | "E_PATH_FORBIDDEN";
  message: string;
};

function rejectAbsoluteOrEmpty(p: string, raw: string): PathFail | null {
  if (p.startsWith("/")) {
    return { ok: false, code: "E_PATH_UNSAFE", message: `Absolute path is not allowed: ${raw}` };
  }
  if (/^[A-Za-z]:\//.test(p) || /^[A-Za-z]:[^/]/.test(p) || /^[A-Za-z]:$/.test(p)) {
    return { ok: false, code: "E_PATH_UNSAFE", message: `Absolute path is not allowed: ${raw}` };
  }
  if (p.length === 0) {
    return { ok: false, code: "E_PATH_UNSAFE", message: `Empty path is not allowed: ${raw}` };
  }
  return null;
}

function rejectUnsafeSegments(segments: string[], raw: string): PathFail | null {
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      return { ok: false, code: "E_PATH_UNSAFE", message: `Unsafe path segment in: ${raw}` };
    }
    for (let i = 0; i < seg.length; i++) {
      if (seg.charCodeAt(i) < 32) {
        return { ok: false, code: "E_PATH_UNSAFE", message: `Control character in path: ${raw}` };
      }
    }
  }
  return null;
}

function rejectForbiddenSegments(segments: string[], raw: string): PathFail | null {
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (lower === ".git" || lower === "node_modules") {
      return { ok: false, code: "E_PATH_FORBIDDEN", message: `Forbidden path segment in: ${raw}` };
    }
  }
  return null;
}

export function normalizePath(
  raw: string,
):
  | { ok: true; path: string }
  | { ok: false; code: "E_PATH_UNSAFE" | "E_PATH_FORBIDDEN"; message: string } {
  const slashified = raw.replace(/\\/g, "/");
  let p = slashified;
  while (p.startsWith("./")) p = p.slice(2);
  p = p.replace(/\/+/g, "/");

  const abs = rejectAbsoluteOrEmpty(p, raw);
  if (abs) return abs;

  const segments = p.split("/");
  const unsafe = rejectUnsafeSegments(segments, raw);
  if (unsafe) return unsafe;

  const forbidden = rejectForbiddenSegments(segments, raw);
  if (forbidden) return forbidden;

  return { ok: true, path: p };
}

function basenameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

function findRootDir(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const tops = paths.map((p) => {
    const i = p.indexOf("/");
    return i === -1 ? null : p.slice(0, i);
  });
  if (tops.some((t) => t === null)) return null;
  const root = tops[0]!;
  if (tops.every((t) => t === root)) return root;
  return null;
}

export type PrepareResult = {
  files: NormalizedFile[];
  rootDir: string | null;
  errors: Issue[];
  warnings: Issue[];
};

export function prepareFiles(input: ArtifactFileInput[]): PrepareResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  if (input.length > LIMITS.maxFiles) {
    errors.push({
      code: ISSUE_CODES.E_TOO_MANY_FILES,
      message: `Bundle has ${input.length} files; maximum is ${LIMITS.maxFiles}`,
    });
    return { files: [], rootDir: null, errors, warnings };
  }

  let total = 0;
  for (const f of input) {
    const size = contentSize(f.content);
    if (size > LIMITS.maxFileBytes) {
      errors.push({
        code: ISSUE_CODES.E_FILE_TOO_LARGE,
        message: `File exceeds ${LIMITS.maxFileBytes} bytes`,
        path: f.path,
      });
    }
    total += size;
  }
  if (total > LIMITS.maxBundleBytes) {
    errors.push({
      code: ISSUE_CODES.E_BUNDLE_TOO_LARGE,
      message: `Bundle exceeds ${LIMITS.maxBundleBytes} bytes`,
    });
  }
  if (errors.length > 0) {
    return { files: [], rootDir: null, errors, warnings };
  }

  const kept: NormalizedFile[] = [];
  const seen = new Set<string>();

  for (const f of input) {
    const norm = normalizePath(f.path);
    if (!norm.ok) {
      errors.push({ code: ISSUE_CODES[norm.code], message: norm.message, path: f.path });
      continue;
    }
    const base = basenameOf(norm.path);
    if (base === ".DS_Store" || base === "Thumbs.db") {
      warnings.push({
        code: ISSUE_CODES.W_FILE_DROPPED,
        message: `Dropped junk file: ${f.path}`,
        path: f.path,
      });
      continue;
    }
    if (seen.has(norm.path)) {
      errors.push({
        code: ISSUE_CODES.E_PATH_DUPLICATE,
        message: `Duplicate path after normalization: ${norm.path}`,
        path: f.path,
      });
      continue;
    }
    seen.add(norm.path);
    kept.push({ path: norm.path, content: f.content, size: contentSize(f.content) });
  }

  const rootDir = findRootDir(kept.map((k) => k.path));
  let files = kept;
  if (rootDir) {
    const prefix = `${rootDir}/`;
    files = kept.map((k) => ({
      ...k,
      path: k.path.startsWith(prefix) ? k.path.slice(prefix.length) : k.path,
    }));
  }

  return { files, rootDir, errors, warnings };
}
