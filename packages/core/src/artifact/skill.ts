import { ISSUE_CODES } from "./types.ts";
import type { Issue, ParseInput } from "./types.ts";
import type { NormalizedFile } from "./paths.ts";
import { toUint8Array } from "./paths.ts";
import { contentToString, extractFrontmatter, extractTags } from "./frontmatter.ts";

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type TypeParseOk = {
  name: string;
  description: string;
  displayName: string | null;
  tags: string[];
  frontmatter: Record<string, unknown> | null;
  canonical: Array<{ path: string; content: Uint8Array }>;
  errors: Issue[];
  warnings: Issue[];
};

const SKILL_KNOWN = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
  "tags",
  "category",
  "disable-model-invocation",
  "tools",
  "scope",
  "timeout",
  "argument-hint",
  "model",
  "user-invocable",
]);

function validateName(name: unknown): name is string {
  return typeof name === "string" && name.length >= 1 && name.length <= 64 && NAME_RE.test(name);
}

function resolveDescription(input: ParseInput, fmDesc: unknown, errors: Issue[]): string {
  const desc =
    input.description !== undefined && input.description !== null
      ? input.description
      : typeof fmDesc === "string"
        ? fmDesc
        : undefined;
  if (desc === undefined || desc.length === 0) {
    errors.push({
      code: ISSUE_CODES.E_DESCRIPTION_MISSING,
      message: "Description is required",
    });
    return "";
  }
  if (desc.length > 1024) {
    errors.push({
      code: ISSUE_CODES.E_DESCRIPTION_TOO_LONG,
      message: `Description length ${desc.length} exceeds 1024`,
    });
  }
  return desc;
}

function checkInputName(input: ParseInput, name: string, errors: Issue[]): void {
  if (input.name !== undefined && input.name !== name) {
    errors.push({
      code: ISSUE_CODES.E_NAME_MISMATCH,
      message: `input.name "${input.name}" does not match derived name "${name}"`,
    });
  }
}

function warnUnknownKeys(fm: Record<string, unknown>, known: Set<string>, warnings: Issue[]): void {
  for (const key of Object.keys(fm)) {
    if (!known.has(key)) {
      warnings.push({
        code: ISSUE_CODES.W_UNKNOWN_FRONTMATTER_KEY,
        message: `Unknown frontmatter key: ${key}`,
      });
    }
  }
}

function collectRefs(body: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (ref: string) => {
    if (!ref || seen.has(ref)) return;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref)) return;
    if (ref.startsWith("/")) return;
    seen.add(ref);
    found.push(ref);
  };
  const mdRe = /\]\(([^)\s#]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdRe.exec(body)) !== null) {
    add(m[1]!);
  }
  const tokenRe = /(?:^|\s)((?:scripts|references|assets)\/[^\s`)]+)/gm;
  while ((m = tokenRe.exec(body)) !== null) {
    add(m[1]!);
  }
  return found;
}

function findSkillMarkdown(
  files: NormalizedFile[],
  warnings: Issue[],
): { skillFile: NormalizedFile | undefined; treatedAsSingle: boolean } {
  let skillFile: NormalizedFile | undefined = files.find((f) => f.path === "SKILL.md");
  let treatedAsSingle = false;
  if (!skillFile) {
    const mdFiles = files.filter((f) => f.path.toLowerCase().endsWith(".md"));
    if (mdFiles.length === 1) {
      skillFile = mdFiles[0]!;
      treatedAsSingle = true;
      warnings.push({
        code: ISSUE_CODES.W_SINGLE_FILE_SKILL,
        message: `Treating single markdown file ${skillFile.path} as SKILL.md`,
        path: skillFile.path,
      });
    }
  }
  return { skillFile, treatedAsSingle };
}

function emptySkillResult(errors: Issue[], warnings: Issue[]): TypeParseOk {
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

function resolveSkillName(
  fm: Record<string, unknown>,
  hasBlock: boolean,
  rootDir: string | null,
  errors: Issue[],
): string {
  const nameRaw = fm.name;
  if (hasBlock && !validateName(nameRaw)) {
    errors.push({
      code: ISSUE_CODES.E_NAME_INVALID,
      message: `Invalid skill name: ${String(nameRaw)}`,
    });
  }
  const name = validateName(nameRaw) ? nameRaw : typeof nameRaw === "string" ? nameRaw : "";
  if (rootDir && name && rootDir !== name) {
    errors.push({
      code: ISSUE_CODES.E_NAME_DIR_MISMATCH,
      message: `Directory "${rootDir}" does not match name "${name}": expected ${name}/SKILL.md or skills/${name}/SKILL.md`,
    });
  }
  return name;
}

function validateSkillMetadata(fm: Record<string, unknown>, errors: Issue[]): void {
  if (typeof fm.compatibility === "string" && fm.compatibility.length > 500) {
    errors.push({
      code: ISSUE_CODES.E_COMPATIBILITY_TOO_LONG,
      message: "compatibility exceeds 500 characters",
    });
  }

  if (fm.metadata === undefined) return;
  const meta = fm.metadata;
  let valid = typeof meta === "object" && meta !== null && !Array.isArray(meta);
  if (valid) {
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      if (typeof k !== "string" || typeof v !== "string") {
        valid = false;
        break;
      }
    }
  }
  if (!valid) {
    errors.push({
      code: ISSUE_CODES.E_METADATA_INVALID,
      message: "metadata must be a string-to-string map",
    });
  }
}

function validateSkillBody(
  body: string,
  files: NormalizedFile[],
  errors: Issue[],
  warnings: Issue[],
): void {
  if (body.trim().length === 0) {
    errors.push({ code: ISSUE_CODES.E_BODY_EMPTY, message: "SKILL.md body is empty" });
  }
  const lineCount = body.split(/\r?\n/).length;
  if (lineCount > 500) {
    warnings.push({
      code: ISSUE_CODES.W_SKILL_MD_LONG,
      message: `SKILL.md has ${lineCount} lines (over 500)`,
    });
  }

  const filePaths = new Set(files.map((f) => f.path));
  for (const ref of collectRefs(body)) {
    if (!filePaths.has(ref)) {
      warnings.push({
        code: ISSUE_CODES.W_REFERENCE_MISSING,
        message: `Missing referenced file: ${ref}`,
        path: ref,
      });
    }
  }
}

function buildSkillCanonical(
  files: NormalizedFile[],
  skillFile: NormalizedFile,
  treatedAsSingle: boolean,
  name: string,
): Array<{ path: string; content: Uint8Array }> {
  const canonical: Array<{ path: string; content: Uint8Array }> = [];
  for (const f of files) {
    let outPath: string;
    if (treatedAsSingle && f.path === skillFile.path) {
      outPath = `skills/${name}/SKILL.md`;
    } else {
      outPath = `skills/${name}/${f.path}`;
    }
    canonical.push({ path: outPath, content: toUint8Array(f.content) });
  }
  return canonical;
}

/**
 * `skills/<name>/...` is the path MCP serves a skill under: treat `<name>` as the root, so a client can publish what it
 * read. Only when every file sits under the same second level; `skills/SKILL.md` keeps `skills` as the root.
 */
function unwrapCanonicalLayout(
  files: NormalizedFile[],
  rootDir: string | null,
): { files: NormalizedFile[]; rootDir: string | null } {
  if (rootDir !== "skills") return { files, rootDir };
  const tops = new Set(files.map((f) => (f.path.includes("/") ? f.path.split("/", 1)[0] : "")));
  const [inner] = tops;
  if (tops.size !== 1 || !inner) return { files, rootDir };
  const prefix = `${inner}/`;
  return { files: files.map((f) => ({ ...f, path: f.path.slice(prefix.length) })), rootDir: inner };
}

export function parseSkill(
  rawFiles: NormalizedFile[],
  rawRootDir: string | null,
  input: ParseInput,
): TypeParseOk {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const { files, rootDir } = unwrapCanonicalLayout(rawFiles, rawRootDir);

  const { skillFile, treatedAsSingle } = findSkillMarkdown(files, warnings);
  if (!skillFile) {
    errors.push({
      code: ISSUE_CODES.E_SKILL_MD_MISSING,
      message: "SKILL.md is required (or exactly one .md file)",
    });
    return emptySkillResult(errors, warnings);
  }

  const text = contentToString(skillFile.content);
  const extracted = extractFrontmatter(text);
  errors.push(...extracted.errors);
  warnings.push(...extracted.warnings);
  const fm = extracted.frontmatter ?? {};

  if (!extracted.hasBlock) {
    errors.push({
      code: ISSUE_CODES.E_FRONTMATTER_MISSING,
      message: "SKILL.md must start with a YAML frontmatter block",
      path: skillFile.path,
    });
  }

  if (extracted.frontmatter) {
    warnUnknownKeys(extracted.frontmatter, SKILL_KNOWN, warnings);
  }

  const name = resolveSkillName(fm, extracted.hasBlock, rootDir, errors);
  checkInputName(input, name, errors);
  const description = resolveDescription(input, fm.description, errors);
  validateSkillMetadata(fm, errors);

  const body = extracted.body.replace(/^\r?\n/, "");
  validateSkillBody(body, files, errors, warnings);

  const tags = extractTags(extracted.frontmatter);
  const canonical = buildSkillCanonical(files, skillFile, treatedAsSingle, name);

  return {
    name,
    description,
    displayName: null,
    tags,
    frontmatter: extracted.frontmatter,
    canonical,
    errors,
    warnings,
  };
}

export { resolveDescription, validateName, checkInputName, warnUnknownKeys, collectRefs };
