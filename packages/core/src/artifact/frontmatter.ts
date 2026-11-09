import { parse as parseYaml } from "yaml";
import { ISSUE_CODES } from "./types.ts";
import type { Issue } from "./types.ts";

const LIST_KEYS = new Set(["tags", "tools", "disallowedTools", "skills", "triggers"]);

export type FrontmatterExtract = {
  frontmatter: Record<string, unknown> | null;
  body: string;
  warnings: Issue[];
  errors: Issue[];
  hasBlock: boolean;
};

function splitListValue(raw: string): string[] {
  let s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    s = s.slice(1, -1);
  }
  if (s.length === 0) return [];
  return s
    .split(",")
    .map((x) => x.trim().replace(/^["']|["']$/g, ""))
    .filter((x) => x.length > 0);
}

function normalizeListFields(fm: Record<string, unknown>): void {
  for (const key of LIST_KEYS) {
    if (!(key in fm)) continue;
    const v = fm[key];
    if (typeof v === "string") {
      fm[key] = splitListValue(v);
    } else if (Array.isArray(v)) {
      fm[key] = v.map((x) => String(x));
    }
  }
}

function looseParse(block: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let any = false;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let value = line.slice(idx + 1).trim();
    value = value.replace(/^["']|["']$/g, "");
    if (LIST_KEYS.has(key)) {
      result[key] = splitListValue(value);
    } else {
      result[key] = value;
    }
    any = true;
  }
  return any ? result : null;
}

export function extractFrontmatter(text: string): FrontmatterExtract {
  const warnings: Issue[] = [];
  const errors: Issue[] = [];
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { frontmatter: null, body: text, warnings, errors, hasBlock: false };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    errors.push({
      code: ISSUE_CODES.E_FRONTMATTER_INVALID,
      message: "Frontmatter opening --- without closing ---",
    });
    return { frontmatter: null, body: text, warnings, errors, hasBlock: true };
  }

  const block = lines.slice(1, end).join("\n");
  const body = lines.slice(end + 1).join("\n");

  try {
    const parsed = parseYaml(block);
    if (parsed === null || parsed === undefined) {
      return { frontmatter: {}, body, warnings, errors, hasBlock: true };
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      errors.push({
        code: ISSUE_CODES.E_FRONTMATTER_INVALID,
        message: "Frontmatter must be a mapping",
      });
      return { frontmatter: null, body, warnings, errors, hasBlock: true };
    }
    const fm = { ...(parsed as Record<string, unknown>) };
    normalizeListFields(fm);
    return { frontmatter: fm, body, warnings, errors, hasBlock: true };
  } catch {
    const loose = looseParse(block);
    if (loose === null) {
      errors.push({
        code: ISSUE_CODES.E_FRONTMATTER_INVALID,
        message: "Frontmatter could not be parsed as YAML or loose key: value",
      });
      return { frontmatter: null, body, warnings, errors, hasBlock: true };
    }
    warnings.push({
      code: ISSUE_CODES.W_FRONTMATTER_LOOSE,
      message: "Frontmatter parsed with loose key: value fallback",
    });
    normalizeListFields(loose);
    return { frontmatter: loose, body, warnings, errors, hasBlock: true };
  }
}

export function extractTags(fm: Record<string, unknown> | null): string[] {
  if (!fm) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: unknown) => {
    if (raw === undefined || raw === null) return;
    const parts = Array.isArray(raw)
      ? raw.map((x) => String(x))
      : typeof raw === "string"
        ? splitListValue(raw)
        : [String(raw)];
    for (const p of parts) {
      const t = p.trim().toLowerCase();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  };
  add(fm.tags);
  add(fm.category);
  return out;
}

export function contentToString(content: string | Uint8Array): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}
