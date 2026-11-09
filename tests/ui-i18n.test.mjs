// The interface text comes from dictionaries, with no mixing.
// The checks that hold with English alone live here:
// 1) Text in a non-Latin script appears in the interface sources only in translated dictionaries `i18n/<code>*`.
// 2) Visible text in components comes from the dictionary: no JSX text and no title/placeholder/aria-label/label/alt
//    attributes with a string literal (except the contents of <code>/<kbd>/<pre> and words from the term list).
// 3) Translations by code: the `codes` section of the English dictionary covers every core ISSUE_CODE and the quality
//    check codes `Q_*`.
// 4) Help tips come from the dictionary (no `tip: "…"` in registry.ts); English help topics are Latin script only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/client.mjs";
import { onlyTerms } from "./lib/i18n-terms.mjs";

const WEB = join(ROOT, "packages", "web", "src");
const I18N = join(WEB, "i18n");
const TOPICS = join(WEB, "help", "topics");
/** A letter of a script other than Latin (Common letters such as the micro sign do not count). */
const NON_LATIN = /(?![\p{Script=Latin}\p{Script=Common}])\p{L}/u;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const stripComments = (code) =>
  code
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
/** A translated dictionary: `i18n/<code>.ts` or a file under `i18n/<code>/`, for any code but English. */
function isTranslatedDict(p) {
  const rel = relative(I18N, p).split(sep);
  if (rel[0] === ".." || !/\.ts$/.test(p)) return false;
  const code = rel.length === 1 ? rel[0].replace(/\.ts$/, "") : rel[0];
  return /^[a-z]{2,3}$/.test(code) && code !== "en";
}
const uiSources = () =>
  walk(WEB).filter((p) => /\.(tsx?|css|html)$/.test(p) && !/\.test\./.test(p) && !p.startsWith(TOPICS + sep));

/** Generics, comparisons and conditional JSX look like `>…<` too; JSX text has none of these. */
const CODE_LIKE = /[;=]|\breturn\b|\bconst\b|\bif\s*\(|\)\s*$|^\s*\(|\|\||&&|\?\s*\(|\)\s*:/;

test("text in a non-Latin script appears in the interface only in translated dictionaries", () => {
  const bad = [];
  for (const p of uiSources()) {
    if (isTranslatedDict(p)) continue;
    stripComments(readFileSync(p, "utf8"))
      .split("\n")
      .forEach((l, i) => NON_LATIN.test(l) && bad.push(`${relative(ROOT, p)}:${i + 1}: ${l.trim().slice(0, 90)}`));
  }
  assert.deepEqual(bad, []);
});

test("visible component text comes from the dictionary (no literals in JSX)", () => {
  const bad = [];
  for (const p of uiSources().filter((f) => f.endsWith(".tsx"))) {
    const code = stripComments(readFileSync(p, "utf8")).replace(/<(code|kbd|pre)\b[^>]*>[\s\S]*?<\/\1>/g, "");
    for (const m of code.matchAll(/>([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g)) {
      if (CODE_LIKE.test(m[1])) continue;
      const text = m[1].trim();
      if (text && !onlyTerms(text)) bad.push(`${relative(ROOT, p)}: "${text.slice(0, 60)}"`);
    }
    for (const m of code.matchAll(/\b(title|placeholder|aria-label|label|alt)="([^"]*[A-Za-z]{2,}[^"]*)"/g)) {
      if (!onlyTerms(m[2])) bad.push(`${relative(ROOT, p)}: ${m[1]}="${m[2].slice(0, 60)}"`);
    }
  }
  assert.deepEqual(bad, [], `${bad.length} literals`);
});

async function english() {
  const en = await import(pathToFileURL(join(I18N, "en.ts")).href).catch(() => null);
  assert.ok(en?.en, "no dictionary packages/web/src/i18n/en.ts (export en)");
  return en.en;
}

test("translations by code: every core ISSUE_CODE and quality check code Q_*", async () => {
  const en = await english();
  const types = readFileSync(join(ROOT, "packages", "core", "src", "artifact", "types.ts"), "utf8");
  const issue = [...types.matchAll(/^\s+([EW]_[A-Z0-9_]+):/gm)].map((m) => m[1]);
  const quality = new Set();
  for (const f of walk(join(ROOT, "packages", "core", "src", "quality"))) {
    for (const m of readFileSync(f, "utf8").matchAll(/["'`](Q_[A-Z0-9_]+)["'`]/g)) quality.add(m[1]);
  }
  const codes = [...issue, ...quality];
  assert.ok(codes.length > 40, `too few codes: ${codes.length}`);
  const missing = codes.filter((c) => !en.codes?.[c]);
  assert.deepEqual(missing, []);
});

test("help tips come from the dictionary; English help topics are Latin script only", () => {
  const reg = readFileSync(join(WEB, "help", "registry.ts"), "utf8");
  const literalTips = [...reg.matchAll(/\btip:\s*["'`]/g)].length;
  assert.equal(literalTips, 0, `registry.ts has ${literalTips} tips as strings, not from the dictionary`);
  const mixed = walk(TOPICS)
    .filter((f) => f.endsWith(".md") && NON_LATIN.test(readFileSync(f, "utf8")))
    .map((f) => relative(TOPICS, f));
  assert.deepEqual(mixed, []);
});
