// Help formatting by documentation best practices:
// every topic starts with why it is needed (`summary`); guides, pages and shortcuts also with what the reader will learn
// (`learn`), and know their navigation section (`section`); sections do not bloat; the heading is not
// duplicated (`# H1` is output by the template); no corrupted characters (e.g. "candidate ? Newly…", "Lifecycle ? SkillForge");
// callouts are of allowed kinds only, and topics about irreversible actions and secrets must warn.
//
// Help frontmatter format (line by line, as in packages/web/src/lib/frontmatter-lite.ts):
//   title: …
//   summary: …                      — 1–2 sentences, up to 240 characters
//   section: <id>                   — navigation section
//   learn:                          — 2–5 items
//     - …
//   related: a/b, c/d
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./lib/client.mjs";

const TOPICS = join(ROOT, "packages", "web", "src", "help", "topics");
const GUIDE_SECTIONS = ["start", "publishing", "lifecycle", "evidence", "access", "automation", "operations"];
const UI_SECTIONS = ["ui-catalog", "ui-workspace", "ui-review", "ui-admin", "ui-other"];
const CALLOUT_KINDS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];
const MUST_WARN = [
  "getting-started/purge",
  "getting-started/self-hosting",
  "pages/admin-backups",
  "pages/tokens",
  "actions/backups/backup-delete",
  "actions/tokens/revoke",
];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** The help frontmatter format: `key: value` lines; a key with an empty value followed by `- item` lines is a list. */
function parse(raw) {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  const data = {};
  let listKey = null;
  for (const line of text.slice(4, end).split("\n")) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(item[1].trim());
      continue;
    }
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    listKey = kv[2] === "" ? kv[1] : null;
    data[kv[1]] = kv[2] === "" ? [] : kv[2].trim();
  }
  return { data, body: text.slice(end + 4).replace(/^\n/, "") };
}

const topics = walk(TOPICS)
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const id = relative(TOPICS, f).replace(/\\/g, "/").replace(/\.md$/, "");
    return { id, ...parse(readFileSync(f, "utf8")) };
  });
const area = (id) => id.split("/")[0];
const isGuide = (t) => area(t.id) === "getting-started" || area(t.id) === "shortcuts";
const isPage = (t) => area(t.id) === "pages";
/** Prose only: code blocks and inline code may legitimately contain ` ? ` (ternaries, URLs). */
const prose = (body) => body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

test("every topic has a summary: why this section exists (1–2 sentences, up to 240 characters)", () => {
  assert.ok(topics.length >= 250, `topics: ${topics.length}`);
  const bad = [];
  for (const t of topics) {
    const s = t.data.summary;
    if (typeof s !== "string" || s.length < 30) bad.push(`${t.id}: no summary`);
    else if (s.length > 240) bad.push(`${t.id}: summary of ${s.length} characters`);
    else if ((s.match(/[.!?](\s|$)/g) ?? []).length > 2) bad.push(`${t.id}: summary longer than two sentences`);
  }
  assert.deepEqual(bad, []);
});

test("guides, pages and shortcuts: learn (2–5 items) and section from the list", () => {
  const bad = [];
  for (const t of topics.filter((x) => isGuide(x) || isPage(x))) {
    const learn = t.data.learn;
    if (!Array.isArray(learn) || learn.length < 2 || learn.length > 5) bad.push(`${t.id}: learn — 2–5 items`);
    else if (learn.some((l) => l.length < 10)) bad.push(`${t.id}: empty or too short learn item`);
    const allowed = isPage(t) ? UI_SECTIONS : GUIDE_SECTIONS;
    if (!allowed.includes(t.data.section)) bad.push(`${t.id}: section "${t.data.section ?? ""}" is not from the list`);
  }
  assert.deepEqual(bad, []);
});

test("a guides or pages section has at most 12 topics, every guides section has topics", () => {
  const counts = {};
  for (const t of topics) if (typeof t.data.section === "string") counts[t.data.section] = (counts[t.data.section] ?? 0) + 1;
  const big = Object.entries(counts).filter(([, n]) => n > 12);
  assert.deepEqual(big, []);
  assert.deepEqual(GUIDE_SECTIONS.filter((s) => !counts[s]), [], "empty guide sections");
});

test("a topic body does not start with # H1 (the template outputs the heading)", () => {
  const bad = topics.filter((t) => /^\s*# /.test(t.body)).map((t) => t.id);
  assert.deepEqual(bad, []);
});

test("no corrupted characters: stray question marks between words, U+FFFD, re-encoding traces", () => {
  const bad = [];
  for (const t of topics) {
    const p = prose(t.body) + "\n" + (t.data.summary ?? "") + "\n" + [].concat(t.data.learn ?? []).join("\n");
    // The ? key (page help) is legitimate prose; a «?» between words or as the title separator is a lost dash/dot.
    // Also a «?» glued between words («1?500», «and?for», «reviewer+?whether»; found while formatting 31.10.2026),
    // but not a query string after a URL path in prose («/lifecycle?tab=review»).
    const hit =
      p.match(/\w[*_]* \? [*_]*\w|(?<![/\w.-])[\p{L}\p{N}]+\+?\?[\p{L}\p{N}]|�|â€|Ã[\u0080-¿]/u) ??
      t.body.match(/\S \? SkillForge/);
    if (hit) bad.push(`${t.id}: «${hit[0]}»`);
    // ``` inside a sentence opens a code block that swallows the following text (eval-runs-runners and
    // Q_WINDOWS_PATH, found while translating 31.10.2026): fences only at the start of a line.
    const fence = /^(?!\s*(?:>\s*)?```).*```.*$/m.exec(t.body);
    if (fence) bad.push(`${t.id}: \`\`\` inside the line "${fence[0].slice(0, 60)}"`);
  }
  assert.deepEqual(bad, []);
});

test("callouts are of allowed kinds only; topics about irreversible actions and secrets warn", () => {
  const bad = [];
  for (const t of topics) {
    for (const m of t.body.matchAll(/^>\s*\[!([A-Za-z]+)\]/gm)) {
      if (!CALLOUT_KINDS.includes(m[1])) bad.push(`${t.id}: callout [!${m[1]}]`);
    }
  }
  for (const id of MUST_WARN) {
    const t = topics.find((x) => x.id === id);
    if (!t) bad.push(`${id}: no such topic`);
    else if (!/^>\s*\[!(CAUTION|WARNING)\]/m.test(t.body)) bad.push(`${id}: no CAUTION or WARNING callout`);
  }
  const withCallouts = topics.filter((t) => /^>\s*\[!/m.test(t.body)).length;
  assert.ok(withCallouts >= 20, `callouts in only ${withCallouts} topics — place them wherever they are needed`);
  assert.deepEqual(bad, []);
});
