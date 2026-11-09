import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config.ts";

/**
 * Help topics the assistant puts into the model context.
 * Built web app: `{webDir}/help-corpus/<lang>/<id>.md` (copied by scripts/build-help-corpus.mjs). Development
 * without a build: the topic sources in packages/web/src/help (`topics` in English, `topics-<lang>` translated).
 * Help is public (it ships in the web bundle).
 */
export type HelpLang = string;

export type CorpusTopic = { id: string; title: string; summary: string; body: string };

const sourceDir = (lang: HelpLang) => (lang === "en" ? "topics" : `topics-${lang}`);
const LANG_RE = /^[a-z]{2,3}$/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".md") ? [p] : [];
  });
}

const unquote = (v: string) =>
  v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0] ? v.slice(1, -1) : v;

/** Line-based help frontmatter (title, summary); the rest of the file is the body. */
export function parseTopic(id: string, raw: string): CorpusTopic {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const end = text.startsWith("---\n") ? text.indexOf("\n---", 3) : -1;
  const head = end === -1 ? "" : text.slice(4, end);
  const body = end === -1 ? text : text.slice(end + 4).replace(/^\n/, "");
  const field = (key: string) =>
    unquote(new RegExp(`^${key}:\\s*(.*)$`, "m").exec(head)?.[1]?.trim() ?? "");
  return { id, title: field("title") || id, summary: field("summary"), body: body.trim() };
}

function candidateDirs(config: AppConfig, lang: HelpLang): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(config.webDir, "help-corpus", lang),
    // packages/server/{dist,src}/llm → packages/web/src/help/<topics dir>
    path.resolve(here, "../../../web/src/help", sourceDir(lang)),
  ];
}

/** Languages that have help topics: English always, plus every translated topic folder that exists. */
export function helpLangs(config: AppConfig): HelpLang[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const built = path.join(config.webDir, "help-corpus");
  const source = path.resolve(here, "../../../web/src/help");
  const names = fs.existsSync(built)
    ? fs.readdirSync(built)
    : fs.existsSync(source)
      ? fs
          .readdirSync(source)
          .filter((n) => n.startsWith("topics-"))
          .map((n) => n.slice("topics-".length))
      : [];
  return ["en", ...names.filter((n) => n !== "en" && LANG_RE.test(n)).sort()];
}

const cache = new Map<string, CorpusTopic[]>();

export function loadCorpus(config: AppConfig, lang: HelpLang): CorpusTopic[] {
  const key = `${config.webDir}|${lang}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const dir = candidateDirs(config, lang).find((d) => fs.existsSync(d));
  const topics = dir
    ? walk(dir)
        .map((f) =>
          parseTopic(
            path.relative(dir, f).replace(/\\/g, "/").replace(/\.md$/, ""),
            fs.readFileSync(f, "utf8"),
          ),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
    : [];
  cache.set(key, topics);
  return topics;
}
