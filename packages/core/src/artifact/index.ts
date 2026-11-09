import { sha256Hex, bundleDigest, compareUtf8Paths } from "../digest.ts";
import { ISSUE_CODES } from "./types.ts";
import type {
  ArtifactType,
  ArtifactFileInput,
  Issue,
  IssueCode,
  ParseInput,
  ParseResult,
  ParsedArtifact,
  PluginComponent,
} from "./types.ts";
import { prepareFiles } from "./paths.ts";
import { contentToString, extractFrontmatter } from "./frontmatter.ts";
import { parseSkill } from "./skill.ts";
import { parseCommand } from "./command.ts";
import { parseAgent } from "./agent.ts";
import { parseHook } from "./hook.ts";
import { parsePlugin } from "./plugin.ts";
import { parseSettings } from "./settings.ts";
import { parseMcpServer } from "./mcp-server.ts";
import type { TypeParseOk } from "./skill.ts";

export type ArtifactTypeDef = {
  id: ArtifactType;
  label: string;
  plural: string;
  mainFile: (name: string) => string;
};

export const ARTIFACT_TYPES: readonly ArtifactTypeDef[] = [
  { id: "skill", label: "Skill", plural: "Skills", mainFile: (n) => `skills/${n}/SKILL.md` },
  { id: "command", label: "Command", plural: "Commands", mainFile: (n) => `commands/${n}.md` },
  { id: "agent", label: "Agent", plural: "Agents", mainFile: (n) => `agents/${n}.md` },
  { id: "hook", label: "Hook", plural: "Hooks", mainFile: () => "hooks/hooks.json" },
  {
    id: "plugin",
    label: "Plugin",
    plural: "Plugins",
    mainFile: () => ".claude-plugin/plugin.json",
  },
  {
    id: "settings",
    label: "Settings profile",
    plural: "Settings profiles",
    mainFile: (n) => `settings/${n}/settings.json`,
  },
  {
    id: "mcp-server",
    label: "MCP server",
    plural: "MCP servers",
    mainFile: (n) => `mcp/${n}/MCP.md`,
  },
] as const;

const ARTIFACT_TYPE_IDS = new Set<string>(ARTIFACT_TYPES.map((t) => t.id));

export function isArtifactType(value: string): value is ArtifactType {
  return ARTIFACT_TYPE_IDS.has(value);
}

export function artifactTypeDef(id: ArtifactType): ArtifactTypeDef {
  return ARTIFACT_TYPES.find((t) => t.id === id)!;
}

function lightNormalize(path: string): string {
  let p = path.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  return p.replace(/\/+/g, "/");
}

type TypedResult = TypeParseOk & { components?: PluginComponent[] };

function parseByType(
  type: ArtifactType,
  files: ReturnType<typeof prepareFiles>["files"],
  rootDir: string | null,
  input: ParseInput,
): TypedResult {
  switch (type) {
    case "skill":
      return parseSkill(files, rootDir, input);
    case "command":
      return parseCommand(files, input);
    case "agent":
      return parseAgent(files, input);
    case "hook":
      return parseHook(files, rootDir, input);
    case "plugin":
      return parsePlugin(files, input);
    case "settings":
      return parseSettings(files, rootDir, input);
    case "mcp-server":
      return parseMcpServer(files, rootDir, input);
  }
}

export function parseArtifact(input: ParseInput): ParseResult {
  const warnings: Issue[] = [];
  const errors: Issue[] = [];

  if (!isArtifactType(input.type)) {
    return {
      ok: false,
      errors: [
        {
          code: ISSUE_CODES.E_TYPE_UNKNOWN,
          message: `Unknown artifact type: ${input.type}`,
        },
      ],
      warnings: [],
    };
  }

  const prepared = prepareFiles(input.files);
  errors.push(...prepared.errors);
  warnings.push(...prepared.warnings);

  const type = input.type;
  const typed = parseByType(type, prepared.files, prepared.rootDir, input);
  errors.push(...typed.errors);
  warnings.push(...typed.warnings);

  const canonical = [...typed.canonical].sort((a, b) => compareUtf8Paths(a.path, b.path));
  const files = canonical.map((c) => ({
    path: c.path,
    sha256: sha256Hex(c.content),
    size: c.content.byteLength,
  }));
  const digest = bundleDigest(files.map(({ path, sha256 }) => ({ path, sha256 })));

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const artifact: ParsedArtifact = {
    type,
    name: typed.name,
    description: typed.description,
    displayName: typed.displayName,
    tags: typed.tags,
    frontmatter: typed.frontmatter,
    files,
    canonical,
    digest,
    ...(typed.components ? { components: typed.components } : {}),
  };
  return { ok: true, artifact, warnings };
}

function stripCommonTopDir(norms: string[]): string[] {
  const tops = norms.map((p) => {
    const i = p.indexOf("/");
    return i === -1 ? null : p.slice(0, i);
  });
  if (tops.length > 0 && tops.every((t) => t !== null) && tops.every((t) => t === tops[0])) {
    const prefix = `${tops[0]!}/`;
    return norms.map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p));
  }
  return norms;
}

function looksLikeAgentFrontmatter(frontmatter: Record<string, unknown>): boolean {
  return (
    typeof frontmatter.name === "string" &&
    typeof frontmatter.description === "string" &&
    ("model" in frontmatter ||
      "tools" in frontmatter ||
      "disallowedTools" in frontmatter ||
      "skills" in frontmatter ||
      "maxTurns" in frontmatter)
  );
}

function detectFromSingleMarkdown(file: ArtifactFileInput): ArtifactType {
  const text = contentToString(file.content);
  const { frontmatter, hasBlock } = extractFrontmatter(text);
  if (hasBlock && frontmatter && looksLikeAgentFrontmatter(frontmatter)) {
    return "agent";
  }
  return "command";
}

export function detectArtifactType(files: ArtifactFileInput[]): ArtifactType | null {
  const norms = files.map((f) => lightNormalize(f.path));
  // Strip a single common top-level directory for detection (publish sends team-kit/...).
  const stripped = stripCommonTopDir(norms);

  if (stripped.some((p) => p === ".claude-plugin/plugin.json")) {
    return "plugin";
  }
  if (stripped.some((p) => p === "SETTINGS.md" || /(^|\/)SETTINGS\.md$/i.test(p))) {
    return "settings";
  }
  if (stripped.some((p) => p === "hooks.json" || p.endsWith("/hooks.json"))) {
    return "hook";
  }
  if (stripped.some((p) => p === "SKILL.md" || p.endsWith("/SKILL.md"))) {
    return "skill";
  }
  if (stripped.some((p) => p === "MCP.md" || /(^|\/)MCP\.md$/i.test(p))) {
    return "mcp-server";
  }
  const md = files.filter((_, i) => stripped[i]!.toLowerCase().endsWith(".md"));
  if (md.length === 1) {
    return detectFromSingleMarkdown(md[0]!);
  }
  return null;
}

export type {
  ArtifactType,
  ArtifactFileInput,
  ParseInput,
  Issue,
  IssueCode,
  ParsedArtifact,
  ParseResult,
  PluginComponent,
};
export { ISSUE_CODES, HOOK_EVENTS, LIMITS } from "./types.ts";
export type { PluginComponentType } from "./types.ts";
export { scanImportTree } from "./scan.ts";
export type { ScanCandidate, ScanResult, ScanSkipped, ScanProvenance } from "./scan.ts";
