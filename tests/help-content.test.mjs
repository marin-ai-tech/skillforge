// Help content standard. Reads packages/web/src/help/topics/**.
// Standard: minimum depth and required structure per area — the quality floor for all future topics.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOPICS = join(ROOT, "packages", "web", "src", "help", "topics");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

function load(p) {
  const raw = readFileSync(p, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const fm = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const body = m ? raw.slice(m[0].length) : raw;
  const id = relative(TOPICS, p).replace(/\\/g, "/").replace(/\.md$/, "");
  return { id, area: id.split("/")[0], fm, body, words: body.split(/\s+/).filter(Boolean).length, headings: [...body.matchAll(/^##\s+(.+)$/gm)].map((h) => h[1].trim()) };
}

const topics = walk(TOPICS).map(load);
const byArea = (a) => topics.filter((t) => t.area === a);

const STANDARD = {
  pages: { minWords: 150, headings: ["What this page is for", "What you see", "Common tasks", "Permissions"] },
  "getting-started": { minWords: 200, headings: [] },
  codes: { minWords: 70, headings: ["What it means", "Common causes", "How to fix"] },
  actions: { minWords: 40, headings: ["What it does", "When to use", "Requires"] },
  shortcuts: { minWords: 60, headings: [] },
};

test("all areas are present and non-empty", () => {
  for (const area of Object.keys(STANDARD)) {
    assert.ok(byArea(area).length > 0, `no topics in area ${area}`);
  }
  assert.ok(topics.length >= 70, `expected ≥ 70 topics, found ${topics.length}`);
});

for (const [area, rule] of Object.entries(STANDARD)) {
  test(`area ${area}: depth ≥ ${rule.minWords} words and required sections`, () => {
    const failures = [];
    for (const t of byArea(area)) {
      if (t.words < rule.minWords) failures.push(`${t.id}: ${t.words} words < ${rule.minWords}`);
      for (const h of rule.headings) {
        if (!t.headings.some((x) => x.toLowerCase().startsWith(h.toLowerCase()))) failures.push(`${t.id}: no section "## ${h}"`);
      }
      if (!t.fm.title) failures.push(`${t.id}: no title in frontmatter`);
    }
    assert.deepEqual(failures, [], `standard violations:\n  ${failures.join("\n  ")}`);
  });
}

test("code topics: a fix example in a code block and a note on whether the code blocks publication", () => {
  const failures = [];
  for (const t of byArea("codes")) {
    if (!/```/.test(t.body)) failures.push(`${t.id}: no code block with an example`);
    if (!/\b(Blocking|Warning|Advisory)\b/.test(t.body)) failures.push(`${t.id}: does not say whether it is Blocking, Warning or Advisory`);
    const code = t.id.split("/")[1];
    // Quality codes Q_* do not block publication and are not validator warnings.
    const expectSeverity = code.startsWith("E_") ? "Blocking" : code.startsWith("Q_") ? "Advisory" : "Warning";
    if (!t.body.includes(expectSeverity)) failures.push(`${t.id}: expected "${expectSeverity}"`);
  }
  assert.deepEqual(failures, []);
});

test("getting-started/lifecycle describes all five statuses, who changes them and the removal board", () => {
  const t = topics.find((x) => x.id === "getting-started/lifecycle");
  assert.ok(t, "no topic getting-started/lifecycle");
  for (const s of ["candidate", "active", "aging", "zombie", "retired", "reviewer", "delete today"]) {
    assert.ok(t.body.toLowerCase().includes(s), `lifecycle: no mention of "${s}"`);
  }
});

test("getting-started/roles describes the four roles and their rights", () => {
  const t = topics.find((x) => x.id === "getting-started/roles");
  assert.ok(t, "no topic getting-started/roles");
  for (const s of ["viewer", "contributor", "reviewer", "admin", "publish"]) {
    assert.ok(t.body.toLowerCase().includes(s), `roles: no mention of "${s}"`);
  }
});

test("shortcuts lists ?, Ctrl/⌘+K and Escape", () => {
  const t = byArea("shortcuts")[0];
  assert.ok(t, "no topic shortcuts");
  assert.ok(t.body.includes("?"), "no ?");
  assert.ok(/Ctrl|⌘|Cmd/.test(t.body), "no Ctrl/⌘+K");
  assert.ok(/Escape|Esc/.test(t.body), "no Escape");
});
