import { ISSUE_CODES } from "./types.ts";
import type { Issue, ParseInput } from "./types.ts";
import type { NormalizedFile } from "./paths.ts";
import { toUint8Array } from "./paths.ts";
import { contentToString, extractFrontmatter, extractTags } from "./frontmatter.ts";
import { validateName, resolveDescription, checkInputName, type TypeParseOk } from "./skill.ts";
import { compareUtf8Paths } from "../digest.ts";
import { checkServerJson } from "./mcp-server-checks.ts";

const MCP_MD = "MCP.md";
const SERVER_JSON = "server.json";

function empty(errors: Issue[], warnings: Issue[]): TypeParseOk {
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

function resolveName(
  fm: Record<string, unknown>,
  rootDir: string | null,
  input: ParseInput,
  errors: Issue[],
): string {
  if (!validateName(fm.name)) {
    errors.push({
      code: ISSUE_CODES.E_NAME_INVALID,
      message: `Invalid MCP server name: ${String(fm.name)}`,
      path: MCP_MD,
    });
    return "";
  }
  const name = fm.name;
  checkInputName(input, name, errors);
  if (rootDir && rootDir !== name) {
    errors.push({
      code: ISSUE_CODES.E_NAME_DIR_MISMATCH,
      message: `Directory "${rootDir}" does not match name "${name}"`,
      path: MCP_MD,
    });
  }
  return name;
}

/**
 * An MCP server: `MCP.md` (name, description, tags, documentation) and `server.json` (how to run or reach it,
 * official MCP registry field names). Canonical paths live under `mcp/<name>/`.
 */
export function parseMcpServer(
  files: NormalizedFile[],
  rootDir: string | null,
  input: ParseInput,
): TypeParseOk {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const md = files.find((f) => f.path === MCP_MD || f.path.toLowerCase() === "mcp.md");
  const extracted = md ? extractFrontmatter(contentToString(md.content)) : null;
  if (!extracted || !extracted.hasBlock || !extracted.frontmatter) {
    errors.push({
      code: ISSUE_CODES.E_FRONTMATTER_MISSING,
      message: "An MCP server requires MCP.md with YAML frontmatter",
      path: MCP_MD,
    });
    return empty(errors, warnings);
  }
  const fm = { ...extracted.frontmatter };
  const name = resolveName(fm, rootDir, input, errors);
  const description = resolveDescription(input, fm.description, errors);
  const json = files.find((f) => f.path === SERVER_JSON);
  checkServerJson(json ? contentToString(json.content) : undefined, errors);

  const prefix = name ? `mcp/${name}/` : "mcp/";
  const canonical = files
    .map((f) => ({ path: `${prefix}${f.path}`, content: toUint8Array(f.content) }))
    .sort((a, b) => compareUtf8Paths(a.path, b.path));
  return {
    name,
    description,
    displayName: null,
    tags: extractTags(fm),
    frontmatter: fm,
    canonical,
    errors,
    warnings,
  };
}
