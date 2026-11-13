import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

export type BundleFile = {
  path: string;
  content_base64: string;
};

function isUnsafeRelative(rel: string): boolean {
  if (!rel || rel === ".") return true;
  if (rel.includes("\\")) return true;
  if (path.isAbsolute(rel)) return true;
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return true;
  const parts = rel.split("/");
  if (parts.some((p) => p === ".." || p === "")) return true;
  return false;
}

/**
 * The bundle path of a single file: its base name, or rules/<name>.md when it lies in a rules folder — the server
 * detects a rule by that folder (rule-artifacts), so dropping it would publish the rule as a command.
 */
function singleFilePath(filePath: string): string {
  const parent = path.basename(path.dirname(filePath));
  const base = path.basename(filePath);
  return parent === "rules" && base.toLowerCase().endsWith(".md") ? `rules/${base}` : base;
}

export function collectPublishFiles(inputPath: string): BundleFile[] {
  const resolved = path.resolve(inputPath);
  const st = fs.statSync(resolved);

  if (st.isFile()) {
    const content = fs.readFileSync(resolved);
    return [
      {
        path: singleFilePath(resolved),
        content_base64: content.toString("base64"),
      },
    ];
  }

  if (!st.isDirectory()) {
    throw new Error(`not a file or directory: ${inputPath}`);
  }

  const files: BundleFile[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const s = fs.statSync(full);
      if (s.isDirectory()) walk(full);
      else if (s.isFile()) {
        const rel = path.relative(resolved, full).split(path.sep).join("/");
        if (isUnsafeRelative(rel)) {
          throw new Error(`unsafe path in bundle: ${rel}`);
        }
        files.push({
          path: rel,
          content_base64: fs.readFileSync(full).toString("base64"),
        });
      }
    }
  };
  walk(resolved);

  // command/agent/rule: a folder with one .md → send it like that single file
  if (files.length === 1) {
    const only = files[0]!;
    if (only.path.toLowerCase().endsWith(".md")) {
      return [
        {
          path: singleFilePath(path.join(resolved, only.path)),
          content_base64: only.content_base64,
        },
      ];
    }
  }

  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export type UnzippedFile = {
  path: string;
  content: Buffer;
};

export function unzipBundle(zipBytes: Uint8Array, intoDir: string): UnzippedFile[] {
  const intoResolved = path.resolve(intoDir);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid zip: ${msg}`);
  }

  const out: UnzippedFile[] = [];
  for (const [rawPath, data] of Object.entries(entries)) {
    const rel = rawPath.replace(/^\.\//, "");
    if (rel.endsWith("/")) continue;
    if (isUnsafeRelative(rel)) {
      throw new Error(`rejected unsafe zip path: ${rawPath}`);
    }
    const dest = path.resolve(intoResolved, ...rel.split("/"));
    const relToInto = path.relative(intoResolved, dest);
    if (relToInto.startsWith("..") || path.isAbsolute(relToInto)) {
      throw new Error(`rejected zip path escaping into: ${rawPath}`);
    }
    out.push({ path: rel.split("/").join("/"), content: Buffer.from(data) });
  }
  return out;
}

function foldCase(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

/**
 * Path of `p` relative to `root` when `p` is `root` itself (`""`) or lies inside it; otherwise null.
 * Component-wise via `path.relative` (so `/a/skills-old` is not inside `/a/skills`), case-insensitive on Windows.
 */
export function relativeInside(root: string, p: string): string | null {
  const rel = path.relative(foldCase(path.resolve(root)), foldCase(path.resolve(p)));
  if (rel === "..") return null;
  if (rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel;
}

export function isInsideRoot(root: string, p: string): boolean {
  return relativeInside(root, p) !== null;
}

function entryExists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** realpath of the nearest existing ancestor of `p` (links resolved) with the missing tail re-appended. */
function realpathViaExistingAncestor(p: string): string {
  let cur = path.resolve(p);
  const tail: string[] = [];
  while (!entryExists(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(fs.realpathSync(cur), ...tail);
}

/**
 * Before any write or delete: every target must stay inside `base` after resolving symlinks/junctions
 * of its nearest existing ancestor. `base` itself may be a link. Throws before touching anything.
 */
export function assertRealPathsInside(base: string, targets: readonly string[]): void {
  const realBase = realpathViaExistingAncestor(base);
  for (const target of targets) {
    let real: string;
    try {
      if (!isInsideRoot(base, target)) throw new Error("outside");
      real = realpathViaExistingAncestor(target);
    } catch {
      throw new Error(
        `refusing to write or delete ${target}: path cannot be resolved inside ${base}`,
      );
    }
    if (!isInsideRoot(realBase, real)) {
      throw new Error(
        `refusing to write or delete ${target}: it resolves to ${real}, outside ${realBase} (symlink or junction)`,
      );
    }
  }
}

export function assertSafeRelPath(rel: string, intoDir: string): string {
  if (isUnsafeRelative(rel)) {
    throw new Error(`rejected unsafe path: ${rel}`);
  }
  const intoResolved = path.resolve(intoDir);
  const dest = path.resolve(intoResolved, ...rel.split("/"));
  const relToInto = path.relative(intoResolved, dest);
  if (relToInto.startsWith("..") || path.isAbsolute(relToInto)) {
    throw new Error(`rejected path escaping into: ${rel}`);
  }
  return dest;
}
