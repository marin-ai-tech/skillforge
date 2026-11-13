import { ISSUE_CODES, LIMITS } from "./types.ts";
import type { Issue, ParseInput } from "./types.ts";
import type { NormalizedFile } from "./paths.ts";
import { toUint8Array } from "./paths.ts";
import { contentToString, extractFrontmatter, extractTags } from "./frontmatter.ts";
import {
  checkInputName,
  resolveDescription,
  validateName,
  warnUnknownKeys,
  type TypeParseOk,
} from "./skill.ts";
import { tokensEst } from "../quality/tokens.ts";

/**
 * A project rule (rule-artifacts): one markdown file with `name`, `description`, optional `paths` (glob patterns of the
 * files it applies to; without it the rule applies always) and `tags`. Canonical path `rules/<name>.md`. A rule
 * without `paths` is loaded on every agent turn, so its length is gated (`E_RULE_ALWAYS_LONG`).
 */
const RULE_KNOWN = new Set(["name", "description", "paths", "tags"]);

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

/** `paths`: absent, or a non-empty list of non-empty strings. */
function checkPaths(raw: unknown, errors: Issue[], path: string): string[] | undefined {
  if (raw === undefined) return undefined;
  const ok =
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((p) => typeof p === "string" && p.trim() !== "");
  if (!ok) {
    errors.push({
      code: ISSUE_CODES.E_RULE_PATHS_INVALID,
      message: "paths must be a non-empty list of file patterns",
      path,
    });
    return undefined;
  }
  return raw as string[];
}

function checkName(fm: Record<string, unknown>, input: ParseInput, errors: Issue[], path: string) {
  if (!validateName(fm.name)) {
    errors.push({
      code: ISSUE_CODES.E_NAME_INVALID,
      message: `Invalid rule name: ${String(fm.name)}`,
      path,
    });
    return "";
  }
  checkInputName(input, fm.name, errors);
  return fm.name;
}

function checkLength(body: string, paths: string[] | undefined, errors: Issue[], path: string) {
  if (paths !== undefined) return;
  const tokens = tokensEst(body);
  if (tokens > LIMITS.ruleAlwaysTokens) {
    errors.push({
      code: ISSUE_CODES.E_RULE_ALWAYS_LONG,
      message: `A rule without paths is loaded on every turn: ${tokens} tokens, the limit is ${LIMITS.ruleAlwaysTokens}; shorten it or add paths`,
      path,
    });
  }
}

export function parseRule(files: NormalizedFile[], input: ParseInput): TypeParseOk {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const md = files.filter((f) => f.path.toLowerCase().endsWith(".md"));
  if (md.length !== 1 || files.length !== 1) {
    errors.push({
      code: md.length === 1 ? ISSUE_CODES.E_RULE_EXTRA_FILE : ISSUE_CODES.E_SINGLE_FILE_REQUIRED,
      message: `A rule is exactly one .md file, found ${files.length} file(s)`,
    });
    return empty(errors, warnings);
  }
  const file = md[0]!;
  const extracted = extractFrontmatter(contentToString(file.content));
  if (!extracted.hasBlock || !extracted.frontmatter) {
    errors.push({
      code: ISSUE_CODES.E_FRONTMATTER_MISSING,
      message: "A rule requires YAML frontmatter with name and description",
      path: file.path,
    });
    return empty(errors, warnings);
  }
  errors.push(...extracted.errors);
  warnings.push(...extracted.warnings);
  const fm = { ...extracted.frontmatter };
  warnUnknownKeys(fm, RULE_KNOWN, warnings);
  const name = checkName(fm, input, errors, file.path);
  const description = resolveDescription(input, fm.description, errors);
  const paths = checkPaths(fm.paths, errors, file.path);
  const body = extracted.body.replace(/^\r?\n/, "");
  if (body.trim().length === 0) {
    errors.push({ code: ISSUE_CODES.E_BODY_EMPTY, message: "Rule body is empty", path: file.path });
  }
  checkLength(body, paths, errors, file.path);
  return {
    name,
    description,
    displayName: null,
    tags: extractTags(fm),
    frontmatter: fm,
    canonical: [{ path: `rules/${name || "rule"}.md`, content: toUint8Array(file.content) }],
    errors,
    warnings,
  };
}
