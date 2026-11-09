// Documentation and help present the supported agents
// as equals. One support table (`getting-started/agent-support`) covers every runtime of the RUNTIMES table; no
// outdated "agents are Claude Code only"; help tips do not list runtimes by hand (a hand list falls behind: the
// runtime choice tip was missing Qwen Code).
// Internal documents that are not published (anything under docs/ except docs/en) are checked only where they exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { RUNTIMES } from "../packages/core/src/runtimes/table.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (rel) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
const exists = (rel) => existsSync(join(ROOT, ...rel.split("/")));
const LABELS = RUNTIMES.map((r) => r.label);

function walk(rel) {
  const abs = join(ROOT, ...rel.split("/"));
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs).flatMap((n) => walk(`${rel}/${n}`));
}

const USER_DOCS = [
  "README.md",
  ...walk("docs/en"),
  ...walk("packages/web/src/help/topics"),
  // internal documents: only where they exist
  ...walk("docs/local-start.md"),
  ...walk("docs/tester-kit"),
  ...walk("docs/self-hosting.md"),
  ...walk("docs/plugins.md"),
].filter((f) => f.endsWith(".md"));

// chore-agents-in-docs (31.10.2026, customer: "too many references to Claude Code", "Install in Claude Code" instead of
// installing into every agent). Claude Code is named legitimately only where a feature exists only in it.
const CLAUDE_ONLY = /plugin|marketplace|hook|settings|plugin-dir|\/plugin/i;

/** Sentences of a markdown file: paragraph lines joined (a phrase may wrap), table rows kept apart. */
function sentences(text) {
  const out = [];
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const units = lines.every((l) => l.trim().startsWith("|")) ? lines : [lines.join(" ")];
    for (const u of units) out.push(...u.split(/(?<=[.!?])\s+|;\s+/));
  }
  return out;
}

test("no outdated \"agents install only into Claude Code\"", () => {
  const bad = [];
  for (const rel of USER_DOCS) {
    for (const s of sentences(read(rel))) {
      const claudeOnly = /Claude Code only|only (in|for) Claude Code/i.test(s);
      const aboutAgents = /\bagents?\b|`agent`|subagent/i.test(s);
      if (claudeOnly && aboutAgents) bad.push(`${rel}: ${s.trim().slice(0, 140)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("help tips do not list runtimes by hand", () => {
  const bad = [];
  read("packages/web/src/help/registry.ts")
    .split("\n")
    .forEach((line, i) => {
      const found = LABELS.filter((l) => line.includes(l));
      if (found.length >= 3) bad.push(`registry.ts:${i + 1}: ${found.join(", ")}`);
    });
  assert.deepEqual(bad, []);
});

test("one agent support table: every runtime of the table; README, the guide and the tester kit link to it", () => {
  const topic = "packages/web/src/help/topics/getting-started/agent-support.md";
  assert.ok(exists(topic), `missing ${topic}`);
  const text = read(topic);
  const rows = text.split("\n").filter((l) => l.trim().startsWith("|"));
  for (const label of LABELS) {
    assert.ok(rows.some((r) => r.includes(label)), `the table has no row for ${label}`);
  }
  for (const rel of ["README.md", "docs/en/02-user-guide.md", ...walk("docs/tester-kit/README.md")]) {
    assert.ok(read(rel).includes("agent-support"), `${rel} does not link to getting-started/agent-support`);
  }
});

test("headings and topic titles do not tie general topics to Claude Code", () => {
  const bad = [];
  // A page of one agent (docs/en/agents/<agent>.md) is about that agent by design; general topics are not.
  for (const rel of USER_DOCS.filter((f) => !/^docs\/en\/agents\/(?!README\.md$)[^/]+\.md$/.test(f))) {
    for (const line of read(rel).split(/\r?\n/)) {
      const heading = /^#{1,6}\s+(.*)$/.exec(line)?.[1] ?? /^title:\s*(.*)$/.exec(line)?.[1];
      if (heading && /Claude Code/.test(heading) && !CLAUDE_ONLY.test(heading)) bad.push(`${rel}: ${heading}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("the install topic describes every agent of the runtime table", () => {
  const rel = "packages/web/src/help/topics/getting-started/install.md";
  const text = read(rel);
  const missing = LABELS.filter((l) => !text.includes(l));
  assert.deepEqual(missing, [], `${rel}: missing ${missing.join(", ")}`);
});

test("interface strings name Claude Code only for its own features", () => {
  const bad = [];
  for (const rel of walk("packages/web/src/i18n/en")) {
    for (const m of read(rel).matchAll(/(["'`])((?:(?!\1).)*Claude Code(?:(?!\1).)*)\1/g)) {
      const str = m[2];
      if (str !== "Claude Code" && !CLAUDE_ONLY.test(str)) bad.push(`${rel}: ${str.slice(0, 120)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("the user document list is not empty (the test really checks something)", () => {
  assert.ok(USER_DOCS.length > 50, String(USER_DOCS.length));
  assert.ok(USER_DOCS.some((f) => relative(ROOT, join(ROOT, f)).startsWith("docs")));
});
