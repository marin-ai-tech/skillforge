import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Session files larger than this are skipped (design: transcripts, not archives). */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Verification command patterns (word-boundary, case-insensitive), shared by every session adapter: the same command
 * counts as a check whatever agent ran it.
 */
export const VERIFY_RE =
  /\b(?:npm\s+(?:test|run\s+(?:test|build|lint))|pnpm\s+(?:test|build|lint)|yarn\s+(?:test|build|lint)|node\s+--test|npx\s+playwright\s+test|pytest|python\s+-m\s+(?:pytest|unittest)|go\s+test|cargo\s+(?:test|build|check)|make\s+(?:test|check|lint)|mvn\s+test|gradle\s+test|dotnet\s+(?:test|build)|tsc\b|eslint\b|ruff\b|phpunit\b|rspec\b)/i;

/** First 32 hex characters of sha256 of the agent's own session id: the id never leaves the machine. */
export function sessionKey(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

function realpathSafe(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function isInsideRoot(rootReal: string, candidateReal: string): boolean {
  const root = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return candidateReal === rootReal || candidateReal.startsWith(root);
}

type Walk = { rootReal: string; ext: string; out: string[]; seen: Set<string> };

function walkSymlinkEntry(w: Walk, full: string, entName: string): void {
  const target = realpathSafe(full);
  if (!target || !isInsideRoot(w.rootReal, target) || w.seen.has(target)) return;
  try {
    const tst = fs.statSync(full);
    if (tst.isDirectory()) {
      w.seen.add(target);
      walkDir(w, full);
    } else if (tst.isFile() && entName.endsWith(w.ext) && tst.size <= MAX_FILE_BYTES) {
      w.seen.add(target);
      w.out.push(full);
    }
  } catch {
    return;
  }
}

function walkDirOrFile(w: Walk, full: string, ent: fs.Dirent, st: fs.Stats): void {
  if (st.isDirectory()) {
    const dirReal = realpathSafe(full);
    if (!dirReal || !isInsideRoot(w.rootReal, dirReal) || w.seen.has(dirReal)) return;
    w.seen.add(dirReal);
    walkDir(w, full);
    return;
  }
  if (!st.isFile()) return;
  if (!ent.name.endsWith(w.ext)) return;
  if (st.size > MAX_FILE_BYTES) return;
  const fileReal = realpathSafe(full);
  if (!fileReal || !isInsideRoot(w.rootReal, fileReal) || w.seen.has(fileReal)) return;
  w.seen.add(fileReal);
  w.out.push(full);
}

function walkDir(w: Walk, dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      walkSymlinkEntry(w, full, ent.name);
      continue;
    }
    walkDirOrFile(w, full, ent, st);
  }
}

/**
 * Files with the extension under `root`, each real file once; links and junctions that lead outside the root are not
 * followed, files over MAX_FILE_BYTES are skipped.
 */
export function findSessionFiles(root: string, ext: string): string[] {
  const rootReal = realpathSafe(root);
  if (!rootReal) return [];
  const w: Walk = { rootReal, ext, out: [], seen: new Set([rootReal]) };
  walkDir(w, root);
  return w.out;
}
