/**
 * Which files of an agent folder the browser sends in a snapshot: the files the server's scanner turns into
 * artifacts, plus `.claude-plugin/plugin.json` of each hook bundle. Everything else (settings.local.json,
 * auth.json, .env…) stays in the browser. This mirrors `artifactUploadPaths` of @skillforge/core path for path;
 * both are checked against the shared fixture tests/fixtures/agents/with-secrets(.expected.json).
 */
export type UploadPaths = { upload: string[]; notSent: string[] };

const CLIENT_DIR = String.raw`(?:^|/)\.(?:claude|codex|cursor|opencode|qwen|gemini)/`;
const COMMAND_RE = [
  /^(?:commands|command)\/[^/]+\.(?:md|toml)$/i,
  new RegExp(`${CLIENT_DIR}(?:commands|command)/[^/]+\\.(?:md|toml)$`, "i"),
];
const AGENT_RE = [
  /^(?:agents|agent)\/[^/]+\.(?:md|toml)$/i,
  new RegExp(`${CLIENT_DIR}(?:agents|agent)/[^/]+\\.(?:md|toml)$`, "i"),
];
const RECKON_RE = /(?:^|\/)\.reckon\/skills\/[^/]+\.md$/i;

function normalize(p: string): string {
  let out = p.replace(/\\/g, "/");
  while (out.startsWith("./")) out = out.slice(2);
  return out.replace(/\/+/g, "/");
}

function dirnameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function ignored(p: string): boolean {
  return p.split("/").some((s) => s === "node_modules" || s === ".git" || s === "dist");
}

function under(p: string, dir: string): boolean {
  return p === dir || p.startsWith(`${dir}/`);
}

function claimSkills(paths: string[], claimed: Set<string>): void {
  for (const f of paths) {
    if (f.split("/").pop() !== "SKILL.md") continue;
    const root = dirnameOf(f);
    for (const g of paths) {
      if (root === "" ? g === "SKILL.md" : g.startsWith(`${root}/`)) claimed.add(g);
    }
  }
}

function claimHooks(paths: string[], claimed: Set<string>): void {
  for (const f of paths) {
    if (claimed.has(f) || !(f === "hooks/hooks.json" || f.endsWith("/hooks/hooks.json"))) continue;
    const hooksDir = dirnameOf(f);
    const pluginRoot = dirnameOf(hooksDir);
    const prefix = pluginRoot ? `${pluginRoot}/` : "";
    for (const g of paths) {
      if (claimed.has(g)) continue;
      if (under(g, hooksDir) || under(g, `${prefix}scripts`) || g === `${prefix}README.md`)
        claimed.add(g);
    }
    const manifest = `${prefix}.claude-plugin/plugin.json`;
    if (paths.includes(manifest)) claimed.add(manifest);
  }
}

function claimSingleFiles(paths: string[], claimed: Set<string>, patterns: RegExp[]): void {
  for (const f of paths) {
    if (!claimed.has(f) && patterns.some((re) => re.test(f))) claimed.add(f);
  }
}

export function agentUploadPaths(paths: readonly string[]): UploadPaths {
  const norm = paths.map(normalize);
  const candidates = norm.filter((p) => !ignored(p));
  const claimed = new Set<string>();
  claimSkills(candidates, claimed);
  claimHooks(candidates, claimed);
  claimSingleFiles(candidates, claimed, [RECKON_RE]);
  claimSingleFiles(candidates, claimed, COMMAND_RE);
  claimSingleFiles(candidates, claimed, AGENT_RE);
  const upload: string[] = [];
  const notSent: string[] = [];
  paths.forEach((p, i) => (claimed.has(norm[i]!) ? upload : notSent).push(p));
  return { upload, notSent };
}
