import fs from "node:fs";
import path from "node:path";

const caseInsensitive = process.platform === "win32";

function norm(p: string): string {
  return caseInsensitive ? p.toLowerCase() : p;
}

/** True when candidate equals root or is under root + sep. */
export function pathInsideRoot(candidate: string, root: string): boolean {
  const c = norm(candidate);
  const r = norm(root);
  if (c === r) return true;
  const prefix = r.endsWith(path.sep) ? r : r + path.sep;
  return c.startsWith(prefix);
}

export function pathInsideRoots(resolved: string, roots: string[]): boolean {
  for (const root of roots) {
    if (pathInsideRoot(resolved, path.resolve(root))) return true;
  }
  return false;
}

function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Compare realpath(candidate) against realpath of each root (Windows 8.3 / junctions). */
export function pathInsideRootsReal(realCandidate: string, roots: string[]): boolean {
  for (const root of roots) {
    const realRoot = realpathOrResolve(root);
    if (pathInsideRoot(realCandidate, realRoot)) return true;
  }
  return false;
}

export type ServerPathCheck =
  | { ok: true; resolved: string; realPath: string }
  | { ok: false; status: 400 | 404; error: "path_outside_roots" | "not_found" };

/**
 * Validate a server agent path against configured roots.
 * Order (critical): lexical outside -> 400; missing/not-dir -> 404; realpath outside -> 400.
 */
export function checkServerPathAgainstRoots(serverPath: string, roots: string[]): ServerPathCheck {
  const resolved = path.resolve(serverPath);
  if (!pathInsideRoots(resolved, roots)) {
    return { ok: false, status: 400, error: "path_outside_roots" };
  }
  let st: fs.Stats;
  try {
    if (!fs.existsSync(resolved)) {
      return { ok: false, status: 404, error: "not_found" };
    }
    st = fs.statSync(resolved);
  } catch {
    return { ok: false, status: 404, error: "not_found" };
  }
  if (!st.isDirectory()) {
    return { ok: false, status: 404, error: "not_found" };
  }
  let realPath: string;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {
    return { ok: false, status: 404, error: "not_found" };
  }
  if (!pathInsideRootsReal(realPath, roots)) {
    return { ok: false, status: 400, error: "path_outside_roots" };
  }
  return { ok: true, resolved, realPath };
}
