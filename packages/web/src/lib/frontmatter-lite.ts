export type Frontmatter = {
  title?: string;
  related?: string[];
  [key: string]: string | string[] | undefined;
};

export type ParsedDoc = {
  data: Frontmatter;
  body: string;
};

/** `"a: b"` → `a: b`: authors quote values that contain a colon, as in YAML. */
function unquote(v: string): string {
  return v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0] ? v.slice(1, -1) : v;
}

/**
 * Minimal `---` frontmatter parser: `key: value` lines; `related` is comma-separated; a key with an empty value
 * followed by indented `- item` lines is a list.
 */
export function parseFrontmatter(raw: string): ParsedDoc {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return { data: {}, body: text };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, body: text };
  }
  const fmBlock = text.slice(3, end).replace(/^\r?\n/, "");
  let body = text.slice(end + 4);
  if (body.startsWith("\r\n")) body = body.slice(2);
  else if (body.startsWith("\n")) body = body.slice(1);

  const data: Frontmatter = {};
  let listKey: string | null = null;
  for (const line of fmBlock.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]!.trim()));
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    listKey = null;
    if (key === "related") {
      data.related = value
        ? value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    } else if (value === "") {
      // `key:` followed by `  - item` lines is a list (help topics: `learn`).
      data[key] = [];
      listKey = key;
    } else {
      data[key] = unquote(value);
    }
  }
  return { data, body };
}
