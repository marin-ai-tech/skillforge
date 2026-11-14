import { parseJsonc } from "../mcp/jsonc.ts";

/**
 * opencode-rules: OpenCode loads rules from the files listed in `instructions` of its config (OpenCode docs V1, rules
 * and config, 14.11.2026), so installed rules need one line there. The edit is textual: the rest of the file —
 * comments, order, spacing — stays as the person wrote it.
 */
export const OPENCODE_RULES_GLOB = ".opencode/rules/*.md";

/** Project config files OpenCode reads, highest precedence first (`.opencode` overrides the project root). */
export const OPENCODE_CONFIG_FILES = [
  ".opencode/opencode.jsonc",
  ".opencode/opencode.json",
  "opencode.jsonc",
  "opencode.json",
] as const;

export type OpencodeConfigFile = { rel: string; text: string };
export type OpencodeConfigPlan =
  | { ok: true; rel: string; text: string; changed: boolean }
  | { ok: false; rel: string; reason: string };

type Parsed = { ok: true; instructions: unknown[] | null } | { ok: false; reason: string };

function parseConfig(text: string): Parsed {
  let data: unknown;
  try {
    data = parseJsonc(text);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "the top level is not an object" };
  }
  const inst = (data as { instructions?: unknown }).instructions;
  if (inst === undefined) return { ok: true, instructions: null };
  if (!Array.isArray(inst)) return { ok: false, reason: '"instructions" is not an array' };
  return { ok: true, instructions: inst };
}

/** Index after the string literal that starts at `i` (a `"`). */
function stringEnd(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
  return j + 1;
}

/** Index of the next character that is not whitespace or a comment, from `i`. */
function skipBlank(text: string, i: number): number {
  let j = i;
  for (;;) {
    if (j < text.length && /\s/.test(text[j]!)) j++;
    else if (text.startsWith("//", j)) {
      const nl = text.indexOf("\n", j);
      j = nl === -1 ? text.length : nl;
    } else if (text.startsWith("/*", j)) {
      const end = text.indexOf("*/", j + 2);
      j = end === -1 ? text.length : end + 2;
    } else return j;
  }
}

/** Index after the value (object, array, string or scalar) that starts at `i`. */
function valueEnd(text: string, i: number): number {
  if (text[i] === '"') return stringEnd(text, i);
  if (text[i] !== "{" && text[i] !== "[") {
    let j = i;
    while (j < text.length && !/[\s,}\]/]/.test(text[j]!)) j++;
    return j;
  }
  return containerEnd(text, i);
}

/** Index after the object or array that starts at `i`, skipping strings and comments. */
function containerEnd(text: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const c = text[j]!;
    if (c === '"') {
      j = stringEnd(text, j);
      continue;
    }
    if (c === "/" && (text[j + 1] === "/" || text[j + 1] === "*")) {
      j = skipBlank(text, j);
      continue;
    }
    if (c === "{" || c === "[") depth++;
    if (c === "}" || c === "]") depth--;
    j++;
    if (depth === 0) return j;
  }
  return j;
}

/** Start of the value of the top-level key `instructions`, or null; also the index just after the opening `{`. */
function locate(text: string): { open: number; value: number | null } {
  const open = skipBlank(text, 0) + 1;
  let i = skipBlank(text, open);
  while (i < text.length && text[i] === '"') {
    const keyEnd = stringEnd(text, i);
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    const value = skipBlank(text, skipBlank(text, keyEnd) + 1);
    if (key === "instructions") return { open, value };
    i = skipBlank(text, valueEnd(text, value));
    if (text[i] === ",") i = skipBlank(text, i + 1);
  }
  return { open, value: null };
}

/** Indentation of the first key, or two spaces. */
function indentOf(text: string, open: number): string {
  const m = /^[ \t]*\n([ \t]+)\S/.exec(text.slice(open));
  return m ? m[1]! : "  ";
}

function insertLine(text: string): string {
  const glob = JSON.stringify(OPENCODE_RULES_GLOB);
  const { open, value } = locate(text);
  if (value === null) {
    const empty = text[skipBlank(text, open)] === "}";
    const ind = indentOf(text, open);
    const entry = `\n${ind}"instructions": [${glob}]`;
    return text.slice(0, open) + entry + (empty ? "\n" : ",") + text.slice(open);
  }
  const close = valueEnd(text, value) - 1;
  let last = close - 1;
  while (last > value && /\s/.test(text[last]!)) last--;
  if (last === value) return text.slice(0, value + 1) + glob + text.slice(value + 1);
  const sep = text[last] === "," ? " " : ", ";
  return text.slice(0, last + 1) + sep + glob + text.slice(last + 1);
}

function planFor(file: OpencodeConfigFile, parsed: Parsed & { ok: true }): OpencodeConfigPlan {
  if (parsed.instructions?.includes(OPENCODE_RULES_GLOB)) {
    return { ok: true, rel: file.rel, text: file.text, changed: false };
  }
  const text = insertLine(file.text);
  const check = parseConfig(text);
  if (!check.ok || !check.instructions?.includes(OPENCODE_RULES_GLOB)) {
    return { ok: false, rel: file.rel, reason: "the file could not be edited safely" };
  }
  return { ok: true, rel: file.rel, text, changed: true };
}

/**
 * Where and how the line goes, given the project config files that exist (paths from OPENCODE_CONFIG_FILES): the
 * file that already has `instructions` (highest precedence first), else the root config, else the `.opencode` one,
 * else a new `opencode.json`. Any existing config that does not parse stops the install.
 */
export function planOpencodeInstructions(existing: OpencodeConfigFile[]): OpencodeConfigPlan {
  const ordered = OPENCODE_CONFIG_FILES.map((rel) => existing.find((f) => f.rel === rel)).filter(
    (f): f is OpencodeConfigFile => f !== undefined,
  );
  const parsed = ordered.map((f) => ({ file: f, parsed: parseConfig(f.text) }));
  const bad = parsed.find((p) => !p.parsed.ok);
  if (bad && !bad.parsed.ok) return { ok: false, rel: bad.file.rel, reason: bad.parsed.reason };
  const ok = parsed as Array<{ file: OpencodeConfigFile; parsed: Parsed & { ok: true } }>;
  const pick =
    ok.find((p) => p.parsed.instructions !== null) ??
    ok.find((p) => !p.file.rel.startsWith(".opencode/")) ??
    ok[0];
  if (pick) return planFor(pick.file, pick.parsed);
  const text = `{\n  "$schema": "https://opencode.ai/config.json",\n  "instructions": [${JSON.stringify(OPENCODE_RULES_GLOB)}]\n}\n`;
  return { ok: true, rel: "opencode.json", text, changed: true };
}
