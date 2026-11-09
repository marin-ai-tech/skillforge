import { ISSUE_CODES } from "./types.ts";
import type { Issue, ParseInput, PluginComponent } from "./types.ts";
import type { NormalizedFile } from "./paths.ts";
import { toUint8Array } from "./paths.ts";
import { contentToString } from "./frontmatter.ts";
import { parseSkill, validateName, type TypeParseOk } from "./skill.ts";
import { parseCommand } from "./command.ts";
import { parseAgent } from "./agent.ts";
import { parseHook } from "./hook.ts";
import { compareUtf8Paths } from "../digest.ts";

const MANIFEST_PATH = ".claude-plugin/plugin.json";
const MCP_PATH = ".mcp.json";
const HOOKS_PATH = "hooks/hooks.json";

function basenameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function basenameNoExt(p: string): string {
  const base = basenameOf(p);
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

function prefixIssue(issue: Issue, prefix: string, fallbackPath: string): Issue {
  const path = issue.path
    ? issue.path.startsWith(prefix)
      ? issue.path
      : `${prefix}${issue.path}`
    : fallbackPath;
  return { ...issue, path };
}

function emptyTyped(errors: Issue[], warnings: Issue[] = []): TypeParseOk {
  return {
    name: "",
    description: "",
    displayName: null,
    tags: [],
    frontmatter: null,
    canonical: [],
    errors,
    warnings,
  };
}

function filesForHook(files: NormalizedFile[]): NormalizedFile[] {
  return files.map((f) =>
    f.path === HOOKS_PATH || f.path.endsWith("/hooks/hooks.json")
      ? { ...f, path: "hooks.json" }
      : f,
  );
}

function parseManifestFile(
  manifestFile: NormalizedFile,
  errors: Issue[],
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(contentToString(manifestFile.content)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      errors.push({
        code: ISSUE_CODES.E_PLUGIN_MANIFEST_INVALID,
        message: "plugin.json must be a JSON object",
        path: MANIFEST_PATH,
      });
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    errors.push({
      code: ISSUE_CODES.E_PLUGIN_MANIFEST_INVALID,
      message: "plugin.json is not valid JSON",
      path: MANIFEST_PATH,
    });
    return null;
  }
}

function applyManifestIdentity(
  manifest: Record<string, unknown>,
  input: ParseInput,
  errors: Issue[],
): { name: string; description: string } {
  const nameRaw = manifest.name;
  const descRaw = manifest.description;
  const nameOk = validateName(nameRaw);
  const descOk = typeof descRaw === "string" && descRaw.length >= 1 && descRaw.length <= 1024;
  if (!nameOk || !descOk) {
    errors.push({
      code: ISSUE_CODES.E_PLUGIN_MANIFEST_INVALID,
      message: "plugin.json requires kebab-case name (1-64) and description (1-1024)",
      path: MANIFEST_PATH,
    });
  }
  const name = nameOk ? (nameRaw as string) : "";
  const description = typeof descRaw === "string" ? descRaw : "";
  if (input.name !== undefined && input.name !== name && name) {
    errors.push({
      code: ISSUE_CODES.E_NAME_MISMATCH,
      message: `input.name "${input.name}" does not match derived name "${name}"`,
    });
  }
  return { name, description };
}

function collectSkillComponents(
  files: NormalizedFile[],
  errors: Issue[],
  warnings: Issue[],
  components: PluginComponent[],
): void {
  const skillDirs = new Set<string>();
  for (const f of files) {
    const m = /^skills\/([^/]+)\/SKILL\.md$/i.exec(f.path);
    if (m) skillDirs.add(m[1]!);
  }
  for (const skillName of [...skillDirs].sort()) {
    const prefix = `skills/${skillName}/`;
    const skillFiles = files
      .filter((f) => f.path.startsWith(prefix))
      .map((f) => ({
        path: f.path.slice(prefix.length),
        content: f.content,
        size: f.size,
      }));
    const typed = parseSkill(skillFiles, skillName, { type: "skill", files: skillFiles });
    for (const e of typed.errors) {
      errors.push(prefixIssue(e, prefix, `${prefix}SKILL.md`));
    }
    for (const w of typed.warnings) {
      warnings.push(prefixIssue(w, prefix, `${prefix}SKILL.md`));
    }
    components.push({ type: "skill", name: typed.name || skillName, path: `skills/${skillName}` });
  }
}

function collectCommandComponents(
  files: NormalizedFile[],
  errors: Issue[],
  warnings: Issue[],
  components: PluginComponent[],
): void {
  for (const f of files
    .filter((x) => /^commands\/[^/]+\.md$/i.test(x.path))
    .sort((a, b) => compareUtf8Paths(a.path, b.path))) {
    const cmdFiles = [{ path: basenameOf(f.path), content: f.content, size: f.size }];
    const typed = parseCommand(cmdFiles, { type: "command", files: cmdFiles });
    for (const e of typed.errors) {
      errors.push(prefixIssue(e, "commands/", f.path));
    }
    for (const w of typed.warnings) {
      warnings.push(prefixIssue(w, "commands/", f.path));
    }
    components.push({
      type: "command",
      name: typed.name || basenameNoExt(f.path),
      path: f.path,
    });
  }
}

function collectAgentComponents(
  files: NormalizedFile[],
  errors: Issue[],
  warnings: Issue[],
  components: PluginComponent[],
): void {
  for (const f of files
    .filter((x) => /^agents\/[^/]+\.md$/i.test(x.path))
    .sort((a, b) => compareUtf8Paths(a.path, b.path))) {
    const agentFiles = [{ path: basenameOf(f.path), content: f.content, size: f.size }];
    const typed = parseAgent(agentFiles, { type: "agent", files: agentFiles });
    for (const e of typed.errors) {
      errors.push(prefixIssue(e, "agents/", f.path));
    }
    for (const w of typed.warnings) {
      warnings.push(prefixIssue(w, "agents/", f.path));
    }
    components.push({
      type: "agent",
      name: typed.name || basenameNoExt(f.path),
      path: f.path,
    });
  }
}

function remapHookIssuePath(issuePath: string | undefined): string {
  if (issuePath === "hooks.json" || issuePath?.startsWith("hooks.")) {
    return issuePath === "hooks.json" ? HOOKS_PATH : issuePath!;
  }
  return issuePath ? issuePath : HOOKS_PATH;
}

function isPluginHookRelatedPath(p: string): boolean {
  return (
    p === HOOKS_PATH ||
    p.startsWith("hooks/") ||
    p === "scripts" ||
    p.startsWith("scripts/") ||
    p === "README.md" ||
    p.toLowerCase() === "readme.md"
  );
}

function selectHookBundleFiles(files: NormalizedFile[]): NormalizedFile[] {
  return files.filter((f) => isPluginHookRelatedPath(f.path));
}

function collectHookComponents(
  files: NormalizedFile[],
  name: string,
  description: string,
  errors: Issue[],
  warnings: Issue[],
  components: PluginComponent[],
): void {
  const hooksFile = files.find((f) => f.path === HOOKS_PATH);
  if (!hooksFile) return;

  const prepared = filesForHook(selectHookBundleFiles(files));
  const typed = parseHook(prepared, null, {
    type: "hook",
    files: prepared,
    name: name || undefined,
    description: description || undefined,
  });
  for (const e of typed.errors) {
    errors.push({ ...e, path: remapHookIssuePath(e.path) });
  }
  for (const w of typed.warnings) {
    warnings.push(w.path === "hooks.json" ? { ...w, path: HOOKS_PATH } : w);
  }
  components.push({ type: "hook", name: typed.name || name || "hooks", path: HOOKS_PATH });
}

function isValidMcpRoot(parsed: unknown): parsed is { mcpServers: Record<string, unknown> } {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  return typeof servers === "object" && servers !== null && !Array.isArray(servers);
}

function collectMcpComponents(
  files: NormalizedFile[],
  errors: Issue[],
  components: PluginComponent[],
): void {
  const mcpFile = files.find((f) => f.path === MCP_PATH);
  if (!mcpFile) return;
  try {
    const parsed = JSON.parse(contentToString(mcpFile.content)) as unknown;
    if (!isValidMcpRoot(parsed)) {
      errors.push({
        code: ISSUE_CODES.E_PLUGIN_MCP_INVALID,
        message: ".mcp.json must be an object with mcpServers object",
        path: MCP_PATH,
      });
      return;
    }
    for (const serverName of Object.keys(parsed.mcpServers).sort()) {
      components.push({ type: "mcp_server", name: serverName, path: MCP_PATH });
    }
  } catch {
    errors.push({
      code: ISSUE_CODES.E_PLUGIN_MCP_INVALID,
      message: ".mcp.json is not valid JSON",
      path: MCP_PATH,
    });
  }
}

export type PluginParseOk = TypeParseOk & { components: PluginComponent[] };

export function parsePlugin(files: NormalizedFile[], input: ParseInput): PluginParseOk {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const components: PluginComponent[] = [];

  const manifestFile = files.find((f) => f.path === MANIFEST_PATH);
  if (!manifestFile) {
    errors.push({
      code: ISSUE_CODES.E_PLUGIN_MANIFEST_MISSING,
      message: "Plugin requires .claude-plugin/plugin.json",
      path: MANIFEST_PATH,
    });
    return { ...emptyTyped(errors, warnings), components };
  }

  const manifest = parseManifestFile(manifestFile, errors);
  let name = "";
  let description = "";
  if (manifest) {
    ({ name, description } = applyManifestIdentity(manifest, input, errors));
  }

  collectSkillComponents(files, errors, warnings, components);
  collectCommandComponents(files, errors, warnings, components);
  collectAgentComponents(files, errors, warnings, components);
  collectHookComponents(files, name, description, errors, warnings, components);
  collectMcpComponents(files, errors, components);

  if (components.length === 0) {
    errors.push({
      code: ISSUE_CODES.E_PLUGIN_EMPTY,
      message: "Plugin has no components (skills, commands, agents, hooks, or MCP servers)",
    });
  }

  components.sort((a, b) => compareUtf8Paths(a.path, b.path));

  const canonical = files
    .map((f) => ({ path: f.path, content: toUint8Array(f.content) }))
    .sort((a, b) => compareUtf8Paths(a.path, b.path));

  return {
    name,
    description,
    displayName: null,
    tags: [],
    frontmatter: manifest,
    canonical,
    errors,
    warnings,
    components,
  };
}
