import { MAX_EXCERPT } from "./types.ts";

export type MarkdownLine = {
  /** 1-based line number in the source file (frontmatter included). */
  line: number;
  text: string;
  /** Fence info-string language of the enclosing block (empty string for a block without one). */
  codeLang: string | null;
};

export type MarkdownFile = {
  path: string;
  text: string;
  lines: MarkdownLine[];
  codeBlocks: number;
  /** Index of the first line after the frontmatter block (0 when there is none). */
  bodyStart: number;
};

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function frontmatterEnd(rawLines: string[]): number {
  if (rawLines[0] !== "---") return 0;
  for (let i = 1; i < rawLines.length; i++) {
    if (rawLines[i] === "---") return i + 1;
  }
  return 0;
}

export function parseMarkdown(path: string, text: string): MarkdownFile {
  const rawLines = text.split(/\r?\n/);
  const lines: MarkdownLine[] = [];
  let codeBlocks = 0;
  let fence: { char: string; length: number; lang: string } | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const m = FENCE_RE.exec(raw);
    if (fence === null) {
      if (m && !(m[1]!.startsWith("`") && m[2]!.includes("`"))) {
        fence = {
          char: m[1]![0]!,
          length: m[1]!.length,
          lang: (m[2]!.trim().split(/\s+/)[0] ?? "").toLowerCase(),
        };
        codeBlocks++;
        lines.push({ line: i + 1, text: raw, codeLang: fence.lang });
        continue;
      }
      lines.push({ line: i + 1, text: raw, codeLang: null });
      continue;
    }
    lines.push({ line: i + 1, text: raw, codeLang: fence.lang });
    if (m && m[1]![0] === fence.char && m[1]!.length >= fence.length && m[2]!.trim().length === 0) {
      fence = null;
    }
  }

  return { path, text, lines, codeBlocks, bodyStart: frontmatterEnd(rawLines) };
}

export function bodyOf(file: MarkdownFile): string {
  return file.lines
    .slice(file.bodyStart)
    .map((l) => l.text)
    .join("\n")
    .replace(/^\r?\n/, "");
}

export function excerptOf(text: string): string {
  const t = text.trim();
  return t.length > MAX_EXCERPT ? t.slice(0, MAX_EXCERPT) : t;
}

const NEGATED_EXAMPLE_RE = /\b(?:non|anti|counter)[-\s]?examples?\b/i;
const EXAMPLE_WORD_RE = /\bexamples?\b/i;

export function hasExampleHeading(file: MarkdownFile): boolean {
  return file.lines.some(
    (l) =>
      l.codeLang === null &&
      /^ {0,3}#{1,6}\s/.test(l.text) &&
      EXAMPLE_WORD_RE.test(l.text) &&
      !NEGATED_EXAMPLE_RE.test(l.text),
  );
}

export function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? "" : path.slice(0, idx);
}

/** Resolves `ref` against `baseDir`; returns null when the path escapes the root. */
export function resolveRef(baseDir: string, ref: string): string | null {
  const out = baseDir.length > 0 ? baseDir.split("/") : [];
  for (const seg of ref.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}
