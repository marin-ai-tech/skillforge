import { stringify as stringifyYaml } from "yaml";
import { extractFrontmatter } from "../artifact/frontmatter.ts";
import type { RuntimeInstallMethod } from "./table.ts";

export type CommandTranslation = {
  /** Path relative to the runtime base directory. */
  path: string;
  content: string;
  warnings: string[];
};

export type CommandTranslateMethod = Extract<
  RuntimeInstallMethod,
  "files" | "gemini-toml" | "opencode-md" | "cursor-md" | "qwen-md"
>;

const OPENING = /^---\r?\n/;
const CLOSING = /(^|\r?\n)---(\r?\n|$)/;

/**
 * Splits a Claude Code markdown file (command or agent) into its parsed frontmatter and the body exactly as written
 * (no newline normalization). `frontmatter` is null when there is no block or it does not parse.
 */
export function splitFrontmatter(text: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
} {
  const open = OPENING.exec(text);
  if (!open) return { frontmatter: null, body: text };
  const rest = text.slice(open[0].length);
  const close = CLOSING.exec(rest);
  if (!close) return { frontmatter: null, body: text };
  const body = rest.slice(close.index + close[0].length);
  return { frontmatter: extractFrontmatter(text).frontmatter, body };
}

/** A frontmatter value as a string, or null when absent. */
export function frontmatterString(raw: unknown): string | null {
  return raw === undefined || raw === null ? null : typeof raw === "string" ? raw : String(raw);
}

/** Splits a Claude Code command into its description and the body exactly as written (no newline normalization). */
export function splitCommand(text: string): { description: string | null; body: string } {
  const { frontmatter, body } = splitFrontmatter(text);
  return { description: frontmatterString(frontmatter?.description), body };
}

function escapeChar(ch: string): string {
  switch (ch) {
    case "\\":
      return "\\\\";
    case '"':
      return '\\"';
    case "\b":
      return "\\b";
    case "\t":
      return "\\t";
    case "\n":
      return "\\n";
    case "\f":
      return "\\f";
    case "\r":
      return "\\r";
    default:
      return `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
  }
}

/** TOML basic string `"…"`. */
export function tomlBasicString(value: string): string {
  // eslint-disable-next-line no-control-regex
  return `"${value.replace(/[\\"\u0000-\u001f\u007f]/g, escapeChar)}"`;
}

/** TOML multi-line basic string `"""…"""`; decodes to exactly `value`. */
export function tomlMultilineBasicString(value: string): string {
  // eslint-disable-next-line no-control-regex
  const escaped = value.replace(/[\\"\u0000-\u0009\u000b-\u001f\u007f]/g, (ch) =>
    ch === "\t" ? ch : escapeChar(ch),
  );
  return `"""\n${escaped}"""`;
}

/** Whether `value` can be written as a multi-line literal string `'''…'''` and read back unchanged. */
export function fitsTomlMultilineLiteral(value: string): boolean {
  if (value.includes("'''") || value.endsWith("'")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return false;
  return !/\r(?!\n)/.test(value);
}

/** TOML multi-line string for `value`: literal `'''…'''` when possible, otherwise escaped basic `"""…"""`. */
export function tomlMultilineString(value: string): string {
  return fitsTomlMultilineLiteral(value) ? `'''\n${value}'''` : tomlMultilineBasicString(value);
}

/**
 * Replaces `$ARGUMENTS` with `{{args}}` (Gemini CLI and Qwen Code) and warns about positional `$1…$9`, which
 * `client` (display name) has no equivalent for and which are kept as is.
 */
export function toArgsPlaceholder(
  name: string,
  body: string,
  client: string,
): { body: string; warnings: string[] } {
  const found = [...new Set(body.match(/\$[1-9]/g) ?? [])];
  const warnings =
    found.length === 0
      ? []
      : [
          `command ${name}: positional arguments ${found.join(", ")} have no ${client} equivalent and are kept as is; use {{args}}`,
        ];
  return { body: body.replaceAll("$ARGUMENTS", "{{args}}"), warnings };
}

/** Markdown with frontmatter reduced to `description` (omitted when there is none), body unchanged. */
function descriptionMarkdown(description: string | null, body: string): string {
  return description === null
    ? body
    : `---\n${stringifyYaml({ description }, { lineWidth: 0 })}---\n${body}`;
}

/** Gemini CLI custom command (`commands/<name>.toml`). */
export function toGeminiToml(name: string, text: string): CommandTranslation {
  const { description, body } = splitCommand(text);
  const { body: prompt, warnings } = toArgsPlaceholder(name, body, "Gemini CLI");
  const lines: string[] = [];
  if (description !== null) lines.push(`description = ${tomlBasicString(description)}`);
  lines.push(`prompt = ${tomlMultilineString(prompt)}`);
  return { path: `commands/${name}.toml`, content: `${lines.join("\n")}\n`, warnings };
}

/** OpenCode command (`commands/<name>.md`): frontmatter reduced to `description`, body unchanged. */
export function toOpenCodeMarkdown(name: string, text: string): CommandTranslation {
  const { description, body } = splitCommand(text);
  return {
    path: `commands/${name}.md`,
    content: descriptionMarkdown(description, body),
    warnings: [],
  };
}

/**
 * Qwen Code command (`commands/<name>.md`): frontmatter reduced to `description`, `$ARGUMENTS` → `{{args}}`,
 * body otherwise unchanged.
 */
export function toQwenMarkdown(name: string, text: string): CommandTranslation {
  const { description, body } = splitCommand(text);
  const { body: prompt, warnings } = toArgsPlaceholder(name, body, "Qwen Code");
  return {
    path: `commands/${name}.md`,
    content: descriptionMarkdown(description, prompt),
    warnings,
  };
}

/** Cursor command (`commands/<name>.md`): body only. */
export function toCursorMarkdown(name: string, text: string): CommandTranslation {
  return { path: `commands/${name}.md`, content: splitCommand(text).body, warnings: [] };
}

/** Translates a Claude Code command file for the given install method (`files` — unchanged). */
export function translateCommand(
  method: CommandTranslateMethod,
  name: string,
  text: string,
): CommandTranslation {
  switch (method) {
    case "gemini-toml":
      return toGeminiToml(name, text);
    case "opencode-md":
      return toOpenCodeMarkdown(name, text);
    case "cursor-md":
      return toCursorMarkdown(name, text);
    case "qwen-md":
      return toQwenMarkdown(name, text);
    case "files":
      return { path: `commands/${name}.md`, content: text, warnings: [] };
  }
}
