import { parseEdits, type SourceEdit } from "../tracked/edits.ts";
import fs from "node:fs";
import path from "node:path";
import { resolveUnderRoot } from "../imports/sources.ts";

export type PackArtifact = {
  type: string;
  name: string;
  path: string;
  repo: string;
  commit: string;
  source_path: string;
  /** tracked-sources: the pack's local changes as edit rules of the source. */
  edits?: SourceEdit[];
};

export type StarterPack = {
  /** Directory name (used as :id). */
  id: string;
  title: string;
  description: string;
  license: string;
  artifacts: PackArtifact[];
  source_repositories: Array<{ repo: string; commit: string }>;
  /** Absolute path to the pack directory. */
  dir: string;
};

const PACK_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isSafePackId(id: string): boolean {
  return PACK_ID_RE.test(id);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function parseArtifact(raw: unknown): PackArtifact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  if (a.type !== "skill") return null;
  if (!isNonEmptyString(a.name) || !isNonEmptyString(a.path)) return null;
  if (!isNonEmptyString(a.repo) || !isNonEmptyString(a.commit)) return null;
  if (!isNonEmptyString(a.source_path)) return null;
  if (!/^[0-9a-f]{40}$/.test(a.commit)) return null;
  const edits =
    a.edits === undefined ? { ok: true as const, edits: undefined } : parseEdits(a.edits);
  if (!edits.ok) return null;
  return {
    ...(edits.edits ? { edits: edits.edits } : {}),
    type: "skill",
    name: a.name,
    path: a.path,
    repo: a.repo,
    commit: a.commit,
    source_path: a.source_path,
  };
}

/** Validate every artifact.path stays inside the pack directory. */
export function validatePackPaths(
  packDir: string,
  artifacts: PackArtifact[],
): { ok: true } | { ok: false; reason: string } {
  for (const a of artifacts) {
    if (a.path.includes("\\") || a.path.includes("\0") || path.isAbsolute(a.path)) {
      return { ok: false, reason: `artifact path not relative: ${a.name}` };
    }
    if (a.path.split(/[/\\]/).includes("..")) {
      return { ok: false, reason: `artifact path escapes pack: ${a.name}` };
    }
    const resolved = resolveUnderRoot(packDir, a.path);
    if (!resolved.ok) {
      return { ok: false, reason: `artifact path escapes pack: ${a.name}` };
    }
    if (!fs.existsSync(resolved.resolved) || !fs.statSync(resolved.resolved).isDirectory()) {
      return { ok: false, reason: `artifact directory missing: ${a.name}` };
    }
  }
  return { ok: true };
}

/** pack.json as an object, or null (logged) when missing, broken or not an object. */
function readPackJson(packJsonPath: string, dirName: string): Record<string, unknown> | null {
  if (!fs.existsSync(packJsonPath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(packJsonPath, "utf8"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`starter-packs: skipping broken pack.json in ${dirName}: ${msg}`);
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.error(`starter-packs: skipping invalid pack.json in ${dirName}`);
    return null;
  }
  return raw as Record<string, unknown>;
}

type PackHeader = { id: string; title: string; description: string; artifacts: unknown[] };

/** id (matching the directory), title, description, MIT license and an artifacts array. */
function parsePackHeader(p: Record<string, unknown>, dirName: string): PackHeader | null {
  if (!isNonEmptyString(p.id) || !isSafePackId(p.id)) {
    console.error(`starter-packs: skipping pack with invalid id in ${dirName}`);
    return null;
  }
  // Directory name is the install :id; require it to match pack.json id.
  if (p.id !== dirName) {
    console.error(
      `starter-packs: skipping pack whose id "${p.id}" does not match directory "${dirName}"`,
    );
    return null;
  }
  if (!isNonEmptyString(p.title) || !isNonEmptyString(p.description)) {
    console.error(`starter-packs: skipping pack missing title/description in ${dirName}`);
    return null;
  }
  if (p.license !== "MIT") {
    console.error(`starter-packs: skipping non-MIT pack in ${dirName}`);
    return null;
  }
  if (!Array.isArray(p.artifacts)) {
    console.error(`starter-packs: skipping pack without artifacts in ${dirName}`);
    return null;
  }
  return { id: p.id, title: p.title, description: p.description, artifacts: p.artifacts };
}

function parsePackArtifacts(list: unknown[], dirName: string): PackArtifact[] | null {
  const artifacts: PackArtifact[] = [];
  for (const item of list) {
    const a = parseArtifact(item);
    if (!a) {
      console.error(`starter-packs: skipping pack with invalid artifact in ${dirName}`);
      return null;
    }
    artifacts.push(a);
  }
  return artifacts;
}

function parseSourceRepositories(raw: unknown): Array<{ repo: string; commit: string }> {
  const source_repositories: Array<{ repo: string; commit: string }> = [];
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      if (isNonEmptyString(rr.repo) && isNonEmptyString(rr.commit)) {
        source_repositories.push({ repo: rr.repo, commit: rr.commit });
      }
    }
  }
  return source_repositories;
}

function loadOnePack(packDir: string, dirName: string): StarterPack | null {
  const packJsonPath = path.join(packDir, "pack.json");
  const p = readPackJson(packJsonPath, dirName);
  if (!p) return null;
  const header = parsePackHeader(p, dirName);
  if (!header) return null;
  const artifacts = parsePackArtifacts(header.artifacts, dirName);
  if (!artifacts) return null;
  const pathsOk = validatePackPaths(packDir, artifacts);
  if (!pathsOk.ok) {
    console.error(
      `starter-packs: skipping pack with unsafe paths in ${dirName}: ${pathsOk.reason}`,
    );
    return null;
  }
  const source_repositories = parseSourceRepositories(p.source_repositories);
  return {
    id: header.id,
    title: header.title,
    description: header.description,
    license: "MIT",
    artifacts,
    source_repositories,
    dir: packDir,
  };
}

/** Load valid starter packs from a directory. Missing dir → empty list. Broken packs are skipped. */
export function loadStarterPacks(packsRoot: string): StarterPack[] {
  if (!fs.existsSync(packsRoot) || !fs.statSync(packsRoot).isDirectory()) {
    return [];
  }
  const out: StarterPack[] = [];
  for (const name of fs.readdirSync(packsRoot)) {
    if (!isSafePackId(name)) continue;
    const packDir = path.join(packsRoot, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(packDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    // Reject directory junctions/symlinks that could escape.
    try {
      const lst = fs.lstatSync(packDir);
      if (lst.isSymbolicLink()) {
        console.error(`starter-packs: skipping symlink pack dir ${name}`);
        continue;
      }
    } catch {
      continue;
    }
    const pack = loadOnePack(packDir, name);
    if (pack) out.push(pack);
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export function findStarterPack(packsRoot: string, id: string): StarterPack | null {
  if (!isSafePackId(id)) return null;
  return loadStarterPacks(packsRoot).find((p) => p.id === id) ?? null;
}

/** Walk a skill directory; return files with paths prefixed by skillName/. */
export function readSkillPublishFiles(
  packDir: string,
  artifact: PackArtifact,
): Array<{ path: string; content_base64: string }> | null {
  const resolved = resolveUnderRoot(packDir, artifact.path);
  if (!resolved.ok) return null;
  const root = resolved.resolved;
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;

  const files: Array<{ path: string; content_base64: string }> = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      const content = fs.readFileSync(full);
      files.push({
        path: `${artifact.name}/${rel}`,
        content_base64: content.toString("base64"),
      });
    }
  };
  walk(root);
  return files.length > 0 ? files : null;
}
