import { extractFrontmatter } from "../artifact/frontmatter.ts";
import type { RuntimeId } from "./table.ts";

/**
 * rules-block: Codex, Gemini CLI and Qwen Code read rules from one shared file in the project root (AGENTS.md,
 * GEMINI.md, QWEN.md). SkillForge owns one block in it between its own markers; the block is built from the installed
 * rules, and the text outside it — a person's text, the sdlc process-rules block — is never rewritten.
 */
export const RULES_BLOCK_START = "<!-- skillforge:rules:start -->";
export const RULES_BLOCK_END = "<!-- skillforge:rules:end -->";

export type BlockRule = { name: string; text: string };
export type RulesBlockFound = { start: number; end: number; text: string };
export type RulesBlockSearch =
  { ok: true; found: RulesBlockFound | null } | { ok: false; reason: string };

function rulePaths(frontmatter: Record<string, unknown> | null): string[] {
  const raw = frontmatter?.paths;
  if (typeof raw === "string") return [raw];
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
}

function ruleSection(rule: BlockRule): string[] {
  const { frontmatter, body } = extractFrontmatter(rule.text.replace(/\r\n/g, "\n"));
  const text = body.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
  const paths = rulePaths(frontmatter);
  const scope =
    paths.length > 0
      ? [`Applies when working with files matching: ${paths.map((p) => `\`${p}\``).join(", ")}`, ""]
      : [];
  return [`### ${rule.name}`, "", ...scope, text];
}

/** The block for these rules, ordered by name, with LF line ends and no final newline; "" when there are no rules. */
export function renderRulesBlock(rules: readonly BlockRule[], runtime: RuntimeId): string {
  if (rules.length === 0) return "";
  const sorted = [...rules].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const sections = sorted.flatMap((r, i) => (i === 0 ? ruleSection(r) : ["", ...ruleSection(r)]));
  return [
    RULES_BLOCK_START,
    "## Project rules from SkillForge",
    "",
    `<!-- Managed by SkillForge. Do not edit between the markers: change the rule in the registry, then run \`skillforge sync --type rule --runtime ${runtime}\`. -->`,
    "",
    ...sections,
    RULES_BLOCK_END,
  ].join("\n");
}

type MarkerLine = { offset: number; length: number };

function markerLines(text: string, marker: string): MarkerLine[] {
  const found: MarkerLine[] = [];
  let offset = 0;
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trimEnd() === marker) found.push({ offset, length: line.length });
    offset += raw.length + 1;
  }
  return found;
}

/** Finds the SkillForge block: a marker is a whole line; anything but one start before one end is refused. */
export function findRulesBlock(text: string): RulesBlockSearch {
  const starts = markerLines(text, RULES_BLOCK_START);
  const ends = markerLines(text, RULES_BLOCK_END);
  if (starts.length === 0 && ends.length === 0) return { ok: true, found: null };
  const [s] = starts;
  const [e] = ends;
  if (starts.length !== 1 || ends.length !== 1 || !s || !e || e.offset < s.offset) {
    return {
      ok: false,
      reason: `the SkillForge rules markers are broken: expected one "${RULES_BLOCK_START}" line before one "${RULES_BLOCK_END}" line`,
    };
  }
  const end = e.offset + e.length;
  return { ok: true, found: { start: s.offset, end, text: text.slice(s.offset, end) } };
}

const BOM = String.fromCharCode(0xfeff);
const withoutBom = (text: string) => (text.startsWith(BOM) ? text.slice(1) : text);
const isBlank = (text: string) => withoutBom(text).trim() === "";

function removeBlock(text: string, found: RulesBlockFound, eol: string): string | null {
  let before = text.slice(0, found.start);
  let after = text.slice(found.end);
  if (after.startsWith(eol)) after = after.slice(eol.length);
  else if (after.startsWith("\n")) after = after.slice(1);
  if (before.endsWith(eol + eol)) before = before.slice(0, -eol.length);
  const result = before + after;
  return isBlank(result) ? null : result;
}

/**
 * The file text with `block` in place of the current block: appended after an empty line when there is none, removed
 * (with the empty line it was added after) when `block` is "". Line ends follow the file. Returns null when the file
 * should not exist: there was none and there is no block, or nothing but whitespace is left. Throws on broken markers.
 */
export function replaceRulesBlock(text: string | null, block: string): string | null {
  const current = text ?? "";
  const search = findRulesBlock(current);
  if (!search.ok) throw new Error(search.reason);
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const b = block.replace(/\n/g, eol);
  const found = search.found;
  if (found) {
    if (block === "") return removeBlock(current, found, eol);
    return current.slice(0, found.start) + b + current.slice(found.end);
  }
  if (block === "") return text;
  if (withoutBom(current) === "") return `${current}${b}${eol}`;
  const sep = current.endsWith("\n") ? eol : eol + eol;
  return `${current}${sep}${b}${eol}`;
}
