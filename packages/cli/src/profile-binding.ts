import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "./config-error.ts";
import { stripBom } from "./stdin.ts";

/** A CLI profile name: host:port, [::1]:8787, and ordinary identifiers, up to 128 characters. */
export const PROFILE_NAME_RE = /^[A-Za-z0-9[][A-Za-z0-9._:@[\]-]{0,127}$/;

const BINDING_MAX_BYTES = 1024;

function bindingInvalid(filePath: string): ConfigError {
  return new ConfigError("profile_binding_invalid", `${filePath}: expected one profile name`, 1);
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * A project binding is a regular file in a regular `.skillforge` directory, not a symlink.
 * Returns the lstat of the file when both exist and are acceptable types, `null` when this
 * level has no binding, and throws `profile_binding_invalid` when a binding is present but
 * not a regular directory and regular file.
 */
function lstatProjectBinding(filePath: string): fs.Stats | null {
  const resolved = path.resolve(filePath);
  const dirPath = path.dirname(resolved);
  const dirStat = lstatOrNull(dirPath);
  if (!dirStat) return null;
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) throw bindingInvalid(dirPath);
  const fileStat = lstatOrNull(resolved);
  if (!fileStat) return null;
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) throw bindingInvalid(resolved);
  return fileStat;
}

/** Read at most 1 KiB; strip BOM; exactly one non-empty trimmed line; a valid profile name. */
export function parseProfileBinding(filePath: string): string {
  const st = lstatProjectBinding(filePath);
  if (!st) throw bindingInvalid(filePath);
  if (st.size > BINDING_MAX_BYTES) throw bindingInvalid(filePath);
  const raw = fs.readFileSync(filePath, "utf8");
  const text = stripBom(raw);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const name = lines[0];
  if (lines.length !== 1 || !name || !PROFILE_NAME_RE.test(name)) {
    throw bindingInvalid(filePath);
  }
  return name;
}

function sameResolved(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

/**
 * Walk from cwd up to the filesystem root and return the first `.skillforge/profile`
 * that is not the file in the CLI config directory.
 */
export function findProjectBinding(
  cwd: string,
  configPath: string,
): { name: string; path: string } | null {
  const skipped = path.join(path.dirname(path.resolve(configPath)), "profile");
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, ".skillforge", "profile");
    if (!sameResolved(candidate, skipped) && lstatProjectBinding(candidate)) {
      return { name: parseProfileBinding(candidate), path: candidate };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
