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

const COMMAND_KNOWN = new Set([
  "name",
  "description",
  "allowed-tools",
  "argument-hint",
  "model",
  "disable-model-invocation",
  "tools",
  "timeout",
  "tags",
  "category",
]);

function basenameNoExt(path: string): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

export function parseCommand(files: NormalizedFile[], input: ParseInput): TypeParseOk {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const mdFiles = files.filter((f) => f.path.toLowerCase().endsWith(".md"));
  if (mdFiles.length !== 1) {
    errors.push({
      code: ISSUE_CODES.E_SINGLE_FILE_REQUIRED,
      message: `Command requires exactly one .md file, found ${mdFiles.length}`,
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
  const name = basenameNoExt(file.path);
  if (!validateName(name)) {
    errors.push({
      code: ISSUE_CODES.E_NAME_INVALID,
      message: `Invalid command name from filename: ${name}`,
    });
  }
  checkInputName(input, name, errors);

  const text = contentToString(file.content);
  const extracted = extractFrontmatter(text);
  errors.push(...extracted.errors);
  warnings.push(...extracted.warnings);

  const fm = extracted.hasBlock ? extracted.frontmatter : null;
  if (fm) {
    warnUnknownKeys(fm, COMMAND_KNOWN, warnings);
  }

  const displayName = fm && typeof fm.name === "string" ? fm.name : null;

  const description = resolveDescription(input, fm?.description, errors);

  const body = extracted.body.replace(/^\r?\n/, "");
  if (body.trim().length === 0) {
    errors.push({ code: ISSUE_CODES.E_BODY_EMPTY, message: "Command body is empty" });
  }

  const tags = extractTags(fm);
  const canonical = [{ path: `commands/${name}.md`, content: toUint8Array(file.content) }];

  return {
    name,
    description,
    displayName,
    tags,
    frontmatter: fm,
    canonical,
    errors,
    warnings,
  };
}
