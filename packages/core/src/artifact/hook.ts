import { ISSUE_CODES, HOOK_EVENTS } from "./types.ts";
import type { Issue, ParseInput } from "./types.ts";
import type { NormalizedFile } from "./paths.ts";
import { toUint8Array } from "./paths.ts";
import { contentToString } from "./frontmatter.ts";
import { validateName, type TypeParseOk } from "./skill.ts";
import { compareUtf8Paths } from "../digest.ts";

const HOOK_EVENT_SET = new Set<string>(HOOK_EVENTS);

const ENTRY_REQUIRED: Record<string, string[]> = {
  command: ["command"],
  http: ["url"],
  prompt: ["prompt"],
  agent: ["agent"],
  mcp_tool: ["server", "tool"],
};

export function extractPluginRootScripts(command: string): string[] {
  const out: string[] = [];
  const re = /\$\{CLAUDE_PLUGIN_ROOT\}"?\/([^"'\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

function descriptionFromReadme(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.startsWith("# ")) i = 1;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (i >= lines.length) return undefined;
  const para: string[] = [];
  while (i < lines.length && lines[i]!.trim() !== "") {
    para.push(lines[i]!);
    i++;
  }
  const joined = para.join(" ").trim();
  return joined.length > 0 ? joined : undefined;
}

function validateEntryTimeout(e: Record<string, unknown>, path: string, errors: Issue[]): void {
  if (e.timeout === undefined) return;
  if (typeof e.timeout !== "number" || !(e.timeout > 0)) {
    errors.push({
      code: ISSUE_CODES.E_HOOK_ENTRY_INVALID,
      message: "timeout must be a positive number",
      path,
    });
  }
}

function warnMissingCommandScripts(
  e: Record<string, unknown>,
  type: string,
  warnings: Issue[],
  filePaths: Set<string>,
): void {
  if (type !== "command" || typeof e.command !== "string") return;
  for (const rel of extractPluginRootScripts(e.command)) {
    if (!filePaths.has(rel)) {
      warnings.push({
        code: ISSUE_CODES.W_SCRIPT_MISSING,
        message: `Referenced script missing: ${rel}`,
        path: rel,
      });
    }
  }
}

function validateHookEntry(
  entry: unknown,
  path: string,
  errors: Issue[],
  warnings: Issue[],
  filePaths: Set<string>,
): void {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    errors.push({
      code: ISSUE_CODES.E_HOOK_ENTRY_INVALID,
      message: "Hook entry must be an object",
      path,
    });
    return;
  }
  const e = entry as Record<string, unknown>;
  const type = e.type;
  if (typeof type !== "string" || !(type in ENTRY_REQUIRED)) {
    errors.push({
      code: ISSUE_CODES.E_HOOK_ENTRY_INVALID,
      message: `Invalid or missing hook entry type: ${String(type)}`,
      path,
    });
    return;
  }
  for (const field of ENTRY_REQUIRED[type]!) {
    if (typeof e[field] !== "string" || (e[field] as string).length === 0) {
      errors.push({
        code: ISSUE_CODES.E_HOOK_ENTRY_INVALID,
        message: `Hook entry type "${type}" requires string field "${field}"`,
        path,
      });
    }
  }
  validateEntryTimeout(e, path, errors);
  warnMissingCommandScripts(e, type, warnings, filePaths);
}

function validateHookGroup(
  group: unknown,
  event: string,
  gi: number,
  errors: Issue[],
  warnings: Issue[],
  filePaths: Set<string>,
): void {
  if (typeof group !== "object" || group === null || Array.isArray(group)) {
    errors.push({
      code: ISSUE_CODES.E_HOOK_ENTRY_INVALID,
      message: "Hook group must be an object",
      path: `hooks.${event}[${gi}]`,
    });
    return;
  }
  const g = group as Record<string, unknown>;
  const entries = g.hooks;
  if (!Array.isArray(entries)) {
    errors.push({
      code: ISSUE_CODES.E_HOOK_ENTRY_INVALID,
      message: "Hook group requires hooks array",
      path: `hooks.${event}[${gi}].hooks`,
    });
    return;
  }
  entries.forEach((entry, ei) => {
    validateHookEntry(entry, `hooks.${event}[${gi}].hooks[${ei}]`, errors, warnings, filePaths);
  });
}

function validateHooksObject(
  hooks: unknown,
  errors: Issue[],
  warnings: Issue[],
  filePaths: Set<string>,
): void {
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    errors.push({
      code: ISSUE_CODES.E_HOOKS_JSON_INVALID,
      message: "hooks.json must contain a hooks object",
      path: "hooks",
    });
    return;
  }
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!HOOK_EVENT_SET.has(event)) {
      warnings.push({
        code: ISSUE_CODES.W_HOOK_EVENT_UNKNOWN,
        message: `Unknown hook event: ${event}`,
        path: `hooks.${event}`,
      });
    }
    if (!Array.isArray(groups)) {
      errors.push({
        code: ISSUE_CODES.E_HOOK_ENTRY_INVALID,
        message: `hooks.${event} must be an array`,
        path: `hooks.${event}`,
      });
      continue;
    }
    groups.forEach((group, gi) => {
      validateHookGroup(group, event, gi, errors, warnings, filePaths);
    });
  }
}

function parseHooksJsonRoot(
  parsed: unknown,
  errors: Issue[],
  warnings: Issue[],
  filePaths: Set<string>,
): void {
  if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
    errors.push({
      code: ISSUE_CODES.E_HOOKS_JSON_INVALID,
      message: "hooks.json root must be an object",
      path: "hooks.json",
    });
    return;
  }
  validateHooksObject((parsed as Record<string, unknown>).hooks, errors, warnings, filePaths);
}

function resolveHookName(input: ParseInput, rootDir: string | null, errors: Issue[]): string {
  let name = "";
  if (input.name !== undefined && input.name !== null && input.name !== "") {
    name = input.name;
  } else if (rootDir) {
    name = rootDir;
  } else {
    errors.push({
      code: ISSUE_CODES.E_NAME_INVALID,
      message: "Hook name requires input.name or a common root directory",
    });
  }
  if (name && !validateName(name)) {
    errors.push({
      code: ISSUE_CODES.E_NAME_INVALID,
      message: `Invalid hook name: ${name}`,
    });
  }
  return name;
}

function resolveHookDescription(
  input: ParseInput,
  files: NormalizedFile[],
  errors: Issue[],
): string {
  let description = "";
  if (input.description !== undefined && input.description !== null) {
    description = input.description;
  } else {
    const readme = files.find(
      (f) => f.path === "README.md" || f.path.toLowerCase() === "readme.md",
    );
    if (readme) {
      const fromReadme = descriptionFromReadme(contentToString(readme.content));
      if (fromReadme) description = fromReadme;
    }
  }
  if (!description) {
    errors.push({
      code: ISSUE_CODES.E_DESCRIPTION_MISSING,
      message: "Hook description is required (input.description or README.md)",
    });
  } else if (description.length > 1024) {
    errors.push({
      code: ISSUE_CODES.E_DESCRIPTION_TOO_LONG,
      message: `Description length ${description.length} exceeds 1024`,
    });
  }
  return description;
}

export function parseHook(
  files: NormalizedFile[],
  rootDir: string | null,
  input: ParseInput,
): TypeParseOk {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const hooksFile = files.find((f) => f.path === "hooks.json");
  if (!hooksFile) {
    errors.push({
      code: ISSUE_CODES.E_HOOKS_JSON_MISSING,
      message: "hooks.json is required at bundle root",
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

  const filePaths = new Set(files.map((f) => f.path));
  let parsed: unknown;
  try {
    parsed = JSON.parse(contentToString(hooksFile.content));
  } catch {
    errors.push({
      code: ISSUE_CODES.E_HOOKS_JSON_INVALID,
      message: "hooks.json is not valid JSON",
      path: "hooks.json",
    });
    parsed = null;
  }

  if (parsed !== null) {
    parseHooksJsonRoot(parsed, errors, warnings, filePaths);
  }

  const name = resolveHookName(input, rootDir, errors);
  const description = resolveHookDescription(input, files, errors);

  const canonical: Array<{ path: string; content: Uint8Array }> = [];
  for (const f of files) {
    const outPath = f.path === "hooks.json" ? "hooks/hooks.json" : f.path;
    canonical.push({ path: outPath, content: toUint8Array(f.content) });
  }
  canonical.sort((a, b) => compareUtf8Paths(a.path, b.path));

  return {
    name,
    description,
    displayName: null,
    tags: [],
    frontmatter: null,
    canonical,
    errors,
    warnings,
  };
}
