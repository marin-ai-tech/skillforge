import type { ArtifactFileInput, ArtifactType } from "./types.ts";
import { contentToString, extractFrontmatter } from "./frontmatter.ts";
import { normalizeForeign } from "../runtimes/import.ts";

export type ScanProvenance = { source: string; ref: string | null };

export type ScanCandidate = {
  id: string;
  type: ArtifactType;
  root: string;
  files: ArtifactFileInput[];
  nameHint: string;
  provenance: ScanProvenance;
};

export type ScanSkipped = { path: string; reason: string };

export type ScanInvalid = {
  root: string;
  errors: Array<{ code?: string; message?: string; path?: string; severity?: string }>;
};

export type ScanResult = {
  candidates: ScanCandidate[];
  skipped: ScanSkipped[];
  invalid: ScanInvalid[];
};

export type ScanImportOptions = {
  /** Runtime label for normalizeForeign (e.g. qwen {{args}} rewrite). Existing callers omit it. */
  runtime?: string | null;
  /**
   * Import, mirrors and tracked sources: a SKILL.md at the root of the tree takes every file no other candidate took
   * (a folder of one skill is the whole skill). Without it a root SKILL.md is only itself, which the agent scan keeps.
   */
  rootSkillTakesRest?: boolean;
};

type NormFile = { path: string; content: string | Uint8Array };

function lightNormalize(pathStr: string): string {
  let p = pathStr.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  return p.replace(/\/+/g, "/");
}

function dirnameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function basenameNoExt(p: string): string {
  const base = basenameOf(p);
  return base.replace(/\.(md|toml)$/i, "");
}

function isUnderSkippedRoot(norm: string): boolean {
  const segs = norm.split("/");
  return segs.some((s) => s === "node_modules" || s === ".git" || s === "dist");
}

function skillNameFromContent(content: string | Uint8Array, fallback: string): string {
  const text = contentToString(content);
  const { frontmatter, hasBlock } = extractFrontmatter(text);
  if (
    hasBlock &&
    frontmatter &&
    typeof frontmatter.name === "string" &&
    frontmatter.name.length > 0
  ) {
    return frontmatter.name;
  }
  return fallback;
}

function hookNameFromTree(files: NormFile[], pluginRoot: string): string {
  const pluginPath = pluginRoot
    ? `${pluginRoot}/.claude-plugin/plugin.json`
    : ".claude-plugin/plugin.json";
  const plugin = files.find((f) => f.path === pluginPath);
  if (plugin) {
    try {
      const parsed = JSON.parse(contentToString(plugin.content)) as { name?: unknown };
      if (typeof parsed.name === "string" && parsed.name.length > 0) return parsed.name;
    } catch {
      /* ignore */
    }
  }
  if (pluginRoot) {
    const base = basenameOf(pluginRoot);
    if (base) return base;
  }
  return "hooks";
}

function collectSkillDirFiles(
  normalized: NormFile[],
  root: string,
  claimed: Set<string>,
): ArtifactFileInput[] {
  const prefix = root.length > 0 ? root + "/" : "";
  const skillFiles: ArtifactFileInput[] = [];
  for (const g of normalized) {
    if (claimed.has(g.path) || isUnderSkippedRoot(g.path)) continue;
    if (root.length === 0) {
      if (g.path === "SKILL.md") {
        skillFiles.push({ path: "SKILL.md", content: g.content });
        claimed.add(g.path);
      }
    } else if (g.path.startsWith(prefix)) {
      skillFiles.push({ path: g.path.slice(prefix.length), content: g.content });
      claimed.add(g.path);
    }
  }
  return skillFiles;
}

function scanSkillDirectories(
  normalized: NormFile[],
  claimed: Set<string>,
  candidates: ScanCandidate[],
  deferRoot: boolean,
): void {
  for (const f of normalized) {
    if (isUnderSkippedRoot(f.path)) continue;
    if (basenameOf(f.path) !== "SKILL.md") continue;
    const root = dirnameOf(f.path);
    if (root.length === 0 && deferRoot) continue;
    const skillFiles = collectSkillDirFiles(normalized, root, claimed);
    const dirName = root.length > 0 ? basenameOf(root) : "skill";
    const skillMd = skillFiles.find((x) => x.path === "SKILL.md");
    const name = skillNameFromContent(skillMd?.content ?? f.content, dirName);
    candidates.push({
      id: `skill/${name}`,
      type: "skill",
      root,
      files: skillFiles,
      nameHint: name,
      provenance: { source: "human", ref: null },
    });
  }
}

function collectHookFiles(
  normalized: NormFile[],
  hooksDir: string,
  pluginRoot: string,
  claimed: Set<string>,
): ArtifactFileInput[] {
  const scriptsPrefix = (pluginRoot ? pluginRoot + "/" : "") + "scripts/";
  const scriptsDir = (pluginRoot ? pluginRoot + "/" : "") + "scripts";
  const readmePath = pluginRoot ? pluginRoot + "/README.md" : "README.md";
  const hookFiles: ArtifactFileInput[] = [];
  for (const g of normalized) {
    if (claimed.has(g.path) || isUnderSkippedRoot(g.path)) continue;
    const underHooks = g.path === hooksDir || g.path.startsWith(hooksDir + "/");
    const underScripts = g.path === scriptsDir || g.path.startsWith(scriptsPrefix);
    const isReadme = g.path === readmePath;
    if (!underHooks && !underScripts && !isReadme) continue;
    const rel =
      pluginRoot.length > 0 && g.path.startsWith(pluginRoot + "/")
        ? g.path.slice(pluginRoot.length + 1)
        : g.path;
    hookFiles.push({ path: rel, content: g.content });
    claimed.add(g.path);
  }
  return hookFiles;
}

function scanHookBundles(
  normalized: NormFile[],
  claimed: Set<string>,
  candidates: ScanCandidate[],
): void {
  for (const f of normalized) {
    if (claimed.has(f.path) || isUnderSkippedRoot(f.path)) continue;
    if (!(f.path === "hooks/hooks.json" || f.path.endsWith("/hooks/hooks.json"))) continue;
    const hooksDir = dirnameOf(f.path);
    const pluginRoot = dirnameOf(hooksDir);
    const hookFiles = collectHookFiles(normalized, hooksDir, pluginRoot, claimed);
    const name = hookNameFromTree(normalized, pluginRoot);
    candidates.push({
      id: `hook/${name}`,
      type: "hook",
      root: pluginRoot,
      files: hookFiles,
      nameHint: name,
      provenance: { source: "human", ref: null },
    });
  }
}

function scanReckonSkills(
  normalized: NormFile[],
  claimed: Set<string>,
  candidates: ScanCandidate[],
): void {
  for (const f of normalized) {
    if (claimed.has(f.path) || isUnderSkippedRoot(f.path)) continue;
    const m = /(?:^|\/)\.reckon\/skills\/([^/]+)\.md$/i.exec(f.path);
    if (!m) continue;
    const fileName = m[1]!;
    const name = skillNameFromContent(f.content, fileName);
    claimed.add(f.path);
    candidates.push({
      id: `skill/${name}`,
      type: "skill",
      root: dirnameOf(f.path),
      files: [{ path: basenameOf(f.path), content: f.content }],
      nameHint: name,
      provenance: { source: "reckon", ref: f.path },
    });
  }
}

/** Client project dirs scanned next to `.claude`. */
const CLIENT_DIR = String.raw`(?:^|/)\.(?:claude|codex|cursor|opencode|qwen|gemini)/`;

function isCommandPath(p: string): boolean {
  return (
    /^(?:commands|command)\/[^/]+\.(?:md|toml)$/i.test(p) ||
    new RegExp(`${CLIENT_DIR}(?:commands|command)/[^/]+\\.(?:md|toml)$`, "i").test(p)
  );
}

function isAgentPath(p: string): boolean {
  return (
    /^(?:agents|agent)\/[^/]+\.(?:md|toml)$/i.test(p) ||
    new RegExp(`${CLIENT_DIR}(?:agents|agent)/[^/]+\\.(?:md|toml)$`, "i").test(p)
  );
}

function scanSingleMdArtifacts(
  normalized: NormFile[],
  claimed: Set<string>,
  candidates: ScanCandidate[],
  kind: "command" | "agent",
  match: (p: string) => boolean,
): void {
  for (const f of normalized) {
    if (claimed.has(f.path) || isUnderSkippedRoot(f.path)) continue;
    if (!match(f.path)) continue;
    const name = basenameNoExt(f.path);
    claimed.add(f.path);
    candidates.push({
      id: `${kind}/${name}`,
      type: kind,
      root: dirnameOf(f.path),
      files: [{ path: basenameOf(f.path), content: f.content }],
      nameHint: name,
      provenance: { source: "human", ref: null },
    });
  }
}

/** A root SKILL.md that takes the rest of the tree: every file not claimed, not ignored and not the lock file. */
function claimRootSkill(
  normalized: NormFile[],
  claimed: Set<string>,
  candidates: ScanCandidate[],
): void {
  const skillMd = normalized.find((f) => f.path === "SKILL.md");
  if (!skillMd) return;
  const files: ArtifactFileInput[] = [];
  for (const f of normalized) {
    if (claimed.has(f.path) || isUnderSkippedRoot(f.path)) continue;
    if (basenameOf(f.path) === ".skillforge-lock.json") continue;
    files.push({ path: f.path, content: f.content });
    claimed.add(f.path);
  }
  const name = skillNameFromContent(skillMd.content, "skill");
  candidates.unshift({
    id: `skill/${name}`,
    type: "skill",
    root: "",
    files,
    nameHint: name,
    provenance: { source: "human", ref: null },
  });
}

function collectSkipped(normalized: NormFile[], claimed: Set<string>): ScanSkipped[] {
  const skipped: ScanSkipped[] = [];
  for (const f of normalized) {
    if (claimed.has(f.path)) continue;
    if (basenameOf(f.path) === ".skillforge-lock.json") {
      skipped.push({ path: f.path, reason: "lock_file" });
      continue;
    }
    if (isUnderSkippedRoot(f.path)) {
      skipped.push({ path: f.path, reason: "ignored_directory" });
      continue;
    }
    skipped.push({ path: f.path, reason: "unclaimed" });
  }
  return skipped;
}

function applyNormalizeForeign(
  candidates: ScanCandidate[],
  runtime: string | null | undefined,
): { candidates: ScanCandidate[]; invalid: ScanInvalid[] } {
  const out: ScanCandidate[] = [];
  const invalid: ScanInvalid[] = [];
  for (const c of candidates) {
    const result = normalizeForeign(c, runtime);
    if (result.ok) {
      out.push(result.candidate);
    } else {
      invalid.push({ root: result.root, errors: result.errors });
    }
  }
  return { candidates: out, invalid };
}

/**
 * Pure scanner: discover import candidates from a flat file list.
 * Priority: skill directories, then hooks, then reckon skills, then commands/agents.
 * A file may belong to at most one candidate.
 */
export function scanImportTree(
  files: ArtifactFileInput[],
  options?: ScanImportOptions,
): ScanResult {
  const normalized = files.map((f) => ({
    path: lightNormalize(f.path),
    content: f.content,
  }));

  const claimed = new Set<string>();
  const rawCandidates: ScanCandidate[] = [];

  const rootTakesRest = options?.rootSkillTakesRest === true;
  scanSkillDirectories(normalized, claimed, rawCandidates, rootTakesRest);
  scanHookBundles(normalized, claimed, rawCandidates);
  scanReckonSkills(normalized, claimed, rawCandidates);
  scanSingleMdArtifacts(normalized, claimed, rawCandidates, "command", isCommandPath);
  scanSingleMdArtifacts(normalized, claimed, rawCandidates, "agent", isAgentPath);
  if (rootTakesRest) claimRootSkill(normalized, claimed, rawCandidates);

  const { candidates, invalid } = applyNormalizeForeign(rawCandidates, options?.runtime);

  return { candidates, skipped: collectSkipped(normalized, claimed), invalid };
}
