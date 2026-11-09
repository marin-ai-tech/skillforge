import { parse as parseToml } from "smol-toml";
import { stringify as stringifyYaml } from "yaml";
import { contentToString } from "../artifact/frontmatter.ts";
import type { ScanCandidate } from "../artifact/scan.ts";
import { validateName } from "../artifact/skill.ts";
import { ISSUE_CODES } from "../artifact/types.ts";
import { RUNTIME_IDS } from "./table.ts";
import { splitFrontmatter } from "./translate.ts";

/** Runtimes accepted on agent scan / PUT (all installable runtimes plus generic). */
export const IMPORT_RUNTIMES: readonly string[] = [...RUNTIME_IDS, "generic"];

export function isImportRuntime(value: string): boolean {
  return IMPORT_RUNTIMES.includes(value);
}

export type NormalizeForeignError = {
  code: string;
  message: string;
  path?: string;
};

export type NormalizeForeignResult =
  | { ok: true; candidate: ScanCandidate }
  | { ok: false; root: string; errors: NormalizeForeignError[] };

function basenameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function basenameNoExt(p: string): string {
  return basenameOf(p).replace(/\.(md|toml)$/i, "");
}

function absPath(root: string, rel: string): string {
  return root ? `${root}/${rel}` : rel;
}

function markdownWithFrontmatter(fm: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(fm, { lineWidth: 0 })}---\n${body}`;
}

type TomlOk = { ok: true; value: Record<string, unknown> };
type TomlErr = { ok: false; error: string };

function tomlRecord(raw: string): TomlOk | TomlErr {
  try {
    const parsed = parseToml(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "TOML root must be a table" };
    }
    return { ok: true, value: parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function normalizeTomlAgent(
  candidate: ScanCandidate,
  filePath: string,
  text: string,
): NormalizeForeignResult {
  const parsed = tomlRecord(text);
  const fileAbs = absPath(candidate.root, filePath);
  if (!parsed.ok) {
    return {
      ok: false,
      root: candidate.root,
      errors: [{ code: "E_TOML_PARSE", message: parsed.error, path: fileAbs }],
    };
  }
  const body = stringField(parsed.value, "developer_instructions");
  if (body === null) {
    return {
      ok: false,
      root: candidate.root,
      errors: [
        {
          code: "E_DEVELOPER_INSTRUCTIONS_MISSING",
          message: "Codex agent TOML requires developer_instructions",
          path: fileAbs,
        },
      ],
    };
  }
  // The file name is a fallback only when `name` is absent; a present `name` comes from untrusted
  // TOML and must pass the same name rule as the parsers, otherwise the candidate is invalid.
  const hasName = Object.prototype.hasOwnProperty.call(parsed.value, "name");
  const nameRaw: unknown = hasName ? parsed.value.name : basenameNoExt(filePath);
  if (!validateName(nameRaw)) {
    return {
      ok: false,
      root: candidate.root,
      errors: [
        {
          code: ISSUE_CODES.E_NAME_INVALID,
          message: `Invalid agent name: ${String(nameRaw)}`,
          path: fileAbs,
        },
      ],
    };
  }
  const name = nameRaw;
  const description = stringField(parsed.value, "description");
  const fm: Record<string, string> = description === null ? { name } : { name, description };
  const md = markdownWithFrontmatter(fm, body);
  const newPath = filePath.replace(/\.toml$/i, ".md");
  return {
    ok: true,
    candidate: {
      ...candidate,
      id: `agent/${name}`,
      nameHint: name,
      files: [{ path: newPath, content: md }],
    },
  };
}

function normalizeTomlCommand(
  candidate: ScanCandidate,
  filePath: string,
  text: string,
): NormalizeForeignResult {
  const parsed = tomlRecord(text);
  const fileAbs = absPath(candidate.root, filePath);
  if (!parsed.ok) {
    return {
      ok: false,
      root: candidate.root,
      errors: [{ code: "E_TOML_PARSE", message: parsed.error, path: fileAbs }],
    };
  }
  const prompt = stringField(parsed.value, "prompt");
  if (prompt === null) {
    return {
      ok: false,
      root: candidate.root,
      errors: [
        {
          code: "E_PROMPT_MISSING",
          message: "TOML command requires prompt",
          path: fileAbs,
        },
      ],
    };
  }
  const description = stringField(parsed.value, "description");
  const body = prompt.replaceAll("{{args}}", "$ARGUMENTS");
  const name = basenameNoExt(filePath);
  const fm: Record<string, string> = description === null ? {} : { description };
  const md = Object.keys(fm).length === 0 ? body : markdownWithFrontmatter(fm, body);
  const newPath = filePath.replace(/\.toml$/i, ".md");
  return {
    ok: true,
    candidate: {
      ...candidate,
      id: `command/${name}`,
      nameHint: name,
      files: [{ path: newPath, content: md }],
    },
  };
}

function injectAgentName(candidate: ScanCandidate, filePath: string, text: string): ScanCandidate {
  const { frontmatter, body } = splitFrontmatter(text);
  const existing =
    frontmatter && typeof frontmatter.name === "string" && frontmatter.name.length > 0
      ? frontmatter.name
      : null;
  if (existing) return candidate;
  const name = basenameNoExt(filePath);
  const fm: Record<string, unknown> = { ...(frontmatter ?? {}), name };
  const md = markdownWithFrontmatter(fm, body);
  return {
    ...candidate,
    id: `agent/${name}`,
    nameHint: name,
    files: [{ path: filePath, content: md }],
  };
}

function qwenArgsPlaceholder(
  candidate: ScanCandidate,
  filePath: string,
  text: string,
): ScanCandidate {
  if (!text.includes("{{args}}")) return candidate;
  const { frontmatter, body } = splitFrontmatter(text);
  const newBody = body.replaceAll("{{args}}", "$ARGUMENTS");
  const md = frontmatter === null ? newBody : markdownWithFrontmatter(frontmatter, newBody);
  return {
    ...candidate,
    files: [{ path: filePath, content: md }],
  };
}

/**
 * Normalize a foreign (Codex / Cursor / OpenCode / Qwen / Gemini) agent or command candidate
 * into Claude Code markdown before parseArtifact. Never throws: bad TOML or missing required
 * keys become `{ ok: false, ... }`.
 */
export function normalizeForeign(
  candidate: ScanCandidate,
  runtime?: string | null,
): NormalizeForeignResult {
  if (candidate.type !== "agent" && candidate.type !== "command") {
    return { ok: true, candidate };
  }
  const file = candidate.files[0];
  if (!file || candidate.files.length !== 1) {
    return { ok: true, candidate };
  }
  const filePath = file.path;
  const text = contentToString(file.content);
  const isToml = /\.toml$/i.test(filePath);

  if (isToml && candidate.type === "agent") {
    return normalizeTomlAgent(candidate, filePath, text);
  }
  if (isToml && candidate.type === "command") {
    return normalizeTomlCommand(candidate, filePath, text);
  }

  let next = candidate;
  if (candidate.type === "agent") {
    next = injectAgentName(next, filePath, text);
  }
  if (candidate.type === "command" && runtime === "qwen") {
    const current = next.files[0]!;
    next = qwenArgsPlaceholder(next, current.path, contentToString(current.content));
  }
  return { ok: true, candidate: next };
}
