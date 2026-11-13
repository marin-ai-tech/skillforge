export function stripFrontmatter(src: string): string {
  if (!src.startsWith("---")) return src;
  const end = src.indexOf("\n---", 3);
  if (end === -1) return src;
  let rest = src.slice(end + 4);
  if (rest.startsWith("\n")) rest = rest.slice(1);
  return rest;
}

export type Frontmatter = {
  /** Top-level keys in order; nested blocks keep their source lines as the value. */
  entries: Array<[string, string]>;
  /** False when a top-level line is not `key: value` — the caller shows the source instead. */
  ok: boolean;
};

const FM_KEY = /^([A-Za-z0-9_.-]+):[ \t]?(.*)$/;

function unquote(v: string): string {
  const t = v.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0] ? t.slice(1, -1) : t;
}

/** Splits a markdown file into its frontmatter (display-only parse, no YAML library) and body. */
export function splitFrontmatter(src: string): { frontmatter: Frontmatter | null; body: string } {
  const text = src.replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return { frontmatter: null, body: src };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: null, body: src };
  const entries: Array<[string, string]> = [];
  let ok = true;
  for (const line of text.slice(4, end).split("\n")) {
    if (!line.trim()) continue;
    const m = FM_KEY.exec(line);
    const last = entries.at(-1);
    if (m) entries.push([m[1]!, unquote(m[2]!)]);
    else if (last && /^[\s-]/.test(line)) last[1] = last[1] ? `${last[1]}\n${line}` : line;
    else ok = false;
  }
  return { frontmatter: { entries, ok }, body: stripFrontmatter(text) };
}

type FileList = Array<{ path: string }>;
type FilePredicate = (f: { path: string }) => boolean;

const README_RE = /(^|\/)README\.md$/i;

/** Path of the first file matching the first predicate that matches anything (predicates in priority order). */
function firstMatch(files: FileList, ...preds: FilePredicate[]): string | null {
  for (const pred of preds) {
    const found = files.find(pred);
    if (found) return found.path;
  }
  return null;
}

const firstMarkdown = (_name: string, files: FileList) =>
  firstMatch(files, (f) => f.path.endsWith(".md"));

const PRIMARY_BY_TYPE = new Map<string, (name: string, files: FileList) => string | null>([
  [
    "skill",
    (name, files) =>
      firstMatch(
        files,
        (f) =>
          f.path === "skills/" + name + "/SKILL.md" ||
          f.path.endsWith("/SKILL.md") ||
          f.path === "SKILL.md",
      ),
  ],
  ["command", firstMarkdown],
  ["agent", firstMarkdown],
  [
    "plugin",
    (_name, files) =>
      firstMatch(
        files,
        (f) => f.path === ".claude-plugin/plugin.json",
        (f) => README_RE.test(f.path),
      ),
  ],
  [
    "hook",
    (_name, files) =>
      firstMatch(
        files,
        (f) => README_RE.test(f.path),
        (f) => f.path.endsWith("hooks.json") || f.path === "hooks.json",
      ),
  ],
  [
    "settings",
    (name, files) =>
      firstMatch(
        files,
        (f) => f.path === `settings/${name}/SETTINGS.md` || /(^|\/)SETTINGS\.md$/i.test(f.path),
        (f) => f.path === `settings/${name}/settings.json` || /(^|\/)settings\.json$/i.test(f.path),
      ),
  ],
  [
    "rule",
    (name, files) =>
      firstMatch(
        files,
        (f) => f.path === `rules/${name}.md` || /(^|\/)rules\/[^/]+\.md$/i.test(f.path),
      ),
  ],
  [
    "mcp-server",
    (name, files) =>
      firstMatch(
        files,
        (f) => f.path === `mcp/${name}/MCP.md` || /(^|\/)MCP\.md$/i.test(f.path),
        (f) => f.path === `mcp/${name}/server.json` || /(^|\/)server\.json$/i.test(f.path),
      ),
  ],
]);

export function primaryFile(type: string, name: string, files: FileList): string | null {
  if (files.length === 0) return null;
  const pick = PRIMARY_BY_TYPE.get(type);
  const found = pick ? pick(name, files) : null;
  return found ?? files[0]?.path ?? null;
}

export function isTextPath(p: string): boolean {
  return /\.(md|json|txt|sh|py|js|ts|tsx|jsx|yml|yaml|toml|css|html|xml|svg)$/i.test(p);
}
