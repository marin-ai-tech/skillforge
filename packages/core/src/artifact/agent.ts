import { ISSUE_CODES } from "./types.ts";
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

const AGENT_KNOWN = new Set([
  "name",
  "description",
  "model",
  "effort",
  "maxTurns",
  "tools",
  "disallowedTools",
  "skills",
  "memory",
  "background",
  "omitClaudeMd",
  "isolation",
  "tags",
  "category",
]);

function basenameNoExt(path: string): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

export function parseAgent(files: NormalizedFile[], input: ParseInput): TypeParseOk {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const mdFiles = files.filter((f) => f.path.toLowerCase().endsWith(".md"));
  if (mdFiles.length !== 1) {
    errors.push({
      code: ISSUE_CODES.E_SINGLE_FILE_REQUIRED,
      message: `Agent requires exactly one .md file, found ${mdFiles.length}`,
    });
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

  const file = mdFiles[0]!;
  const text = contentToString(file.content);
  const extracted = extractFrontmatter(text);
  errors.push(...extracted.errors);
  warnings.push(...extracted.warnings);

  if (!extracted.hasBlock || !extracted.frontmatter) {
    errors.push({
      code: ISSUE_CODES.E_FRONTMATTER_MISSING,
      message: "Agent requires frontmatter",
    });
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

  const fm = extracted.frontmatter;
  warnUnknownKeys(fm, AGENT_KNOWN, warnings);

  const nameRaw = fm.name;
  if (!validateName(nameRaw)) {
    errors.push({
      code: ISSUE_CODES.E_NAME_INVALID,
      message: `Invalid agent name: ${String(nameRaw)}`,
    });
  }
  const name = validateName(nameRaw) ? nameRaw : typeof nameRaw === "string" ? nameRaw : "";
  checkInputName(input, name, errors);

  const fileBase = basenameNoExt(file.path);
  if (name && fileBase !== name) {
    warnings.push({
      code: ISSUE_CODES.W_NAME_FILE_MISMATCH,
      message: `Filename "${fileBase}" does not match name "${name}"`,
      path: file.path,
    });
  }

  const description = resolveDescription(input, fm.description, errors);

  if (fm.isolation !== undefined && fm.isolation !== "worktree") {
    errors.push({
      code: ISSUE_CODES.E_AGENT_ISOLATION_INVALID,
      message: `isolation must be "worktree" if set, got: ${String(fm.isolation)}`,
    });
  }

  const body = extracted.body.replace(/^\r?\n/, "");
  if (body.trim().length === 0) {
    errors.push({ code: ISSUE_CODES.E_BODY_EMPTY, message: "Agent body is empty" });
  }

  const tags = extractTags(fm);
  const canonical = [{ path: `agents/${name}.md`, content: toUint8Array(file.content) }];

  return {
    name,
    description,
    displayName: null,
    tags,
    frontmatter: fm,
    canonical,
    errors,
    warnings,
  };
}
