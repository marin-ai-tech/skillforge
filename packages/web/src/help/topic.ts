import { parseFrontmatter } from "../lib/frontmatter-lite.ts";

export type HelpArea = "getting-started" | "pages" | "actions" | "codes" | "shortcuts";

export type HelpTopic = {
  id: string;
  title: string;
  area: HelpArea;
  body: string;
  related: string[];
  /** Why the topic exists: one or two sentences shown at the top of the topic. */
  summary: string;
  /** What the reader will learn (guides and pages). */
  learn: string[];
  /** Navigation section from frontmatter (guides and pages); actions and codes get theirs in `sections.ts`. */
  section: string;
  /** Language code of the topic text (`en` topics are the source; others are their translations). */
  lang: string;
};

function areaOf(id: string): HelpArea {
  const root = id.split("/")[0] ?? "";
  if (
    root === "getting-started" ||
    root === "pages" ||
    root === "actions" ||
    root === "codes" ||
    root === "shortcuts"
  ) {
    return root;
  }
  return "pages";
}

const text = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");
const list = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : []);

/** Topics from `import.meta.glob(…, { query: "?raw" })` modules under `prefix` ("./topics/…/x.md" → "…/x"). */
export function topicsFromModules(
  modules: Record<string, string>,
  prefix: string,
  lang: HelpTopic["lang"],
): Map<string, HelpTopic> {
  const out = new Map<string, HelpTopic>();
  for (const [path, raw] of Object.entries(modules)) {
    const id = path.slice(prefix.length).replace(/\.md$/, "");
    const { data, body } = parseFrontmatter(raw);
    out.set(id, {
      id,
      title: text(data.title) || id,
      area: areaOf(id),
      body,
      related: list(data.related),
      summary: text(data.summary),
      learn: list(data.learn),
      section: text(data.section),
      lang,
    });
  }
  return out;
}
