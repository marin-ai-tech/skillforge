// Every `skillforge …` command from the user documents and help exists, and its flags are present in that command's
// `--help`. Rationale: a cookbook promised `skillforge sync --dry-run`, but there is no such flag — it even made it into
// the video storyboard. Requires `npm run build`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "packages", "cli", "dist", "index.js");

function walk(rel) {
  const abs = join(ROOT, ...rel.split("/"));
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs).flatMap((n) => walk(`${rel}/${n}`));
}

const DOCS = [
  "README.md",
  ...walk("docs/local-start.md"),
  ...walk("docs/self-hosting.md"),
  ...walk("docs/mvp-test-cases.md"),
  ...walk("docs/en"),
  ...walk("docs/ru"),
  ...walk("docs/tester-kit"),
  ...walk("packages/web/src/help/topics"),
].filter((f) => f.endsWith(".md"));

const helpCache = new Map();
function help(path) {
  const key = path.join(" ");
  if (!helpCache.has(key)) {
    const r = spawnSync(process.execPath, [CLI, ...path, "--help"], { encoding: "utf8", timeout: 30_000 });
    helpCache.set(key, `${r.stdout}${r.stderr}`);
  }
  return helpCache.get(key);
}

function subcommands(helpText) {
  const i = helpText.indexOf("\nCommands:");
  if (i === -1) return new Set();
  const names = new Set();
  for (const line of helpText.slice(i).split("\n").slice(1)) {
    const m = /^ {2}([a-z][a-z0-9-]*)\b/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

/** Code spans and fenced code lines of a markdown file. */
function codeSnippets(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) out.push(line);
    else for (const m of line.matchAll(/`([^`]+)`/g)) out.push(m[1]);
  }
  return out;
}

/** `skillforge …` invocations: only where `skillforge` starts a command (not a server name in `x mcp add skillforge`). */
function invocations(snippet) {
  const res = [];
  for (const m of snippet.matchAll(/(?<![\w./-])skillforge(?=\s)/g)) {
    const before = snippet.slice(0, m.index).trimEnd();
    if (before && !/(^|\s)(--|&&|\|\||;|\||\$|npx|\()$/.test(before)) continue;
    const rest = snippet.slice(m.index + "skillforge".length);
    const stop = rest.search(/\s(&&|\|\||;|\||#)\s|\sskillforge\s/);
    res.push((stop === -1 ? rest : rest.slice(0, stop)).trim());
  }
  return res;
}

function check(invocation) {
  const tokens = invocation.split(/\s+/).filter(Boolean);
  const path = [];
  for (const t of tokens) {
    if (!/^[a-z][a-z0-9-]*$/.test(t)) break;
    if (!subcommands(help(path)).has(t)) break;
    path.push(t);
  }
  const text = help(path);
  const problems = [];
  for (const t of tokens) {
    const f = /^(--[a-z][a-z0-9-]*)/.exec(t);
    if (!f || f[1] === "--help" || f[1] === "--version") continue;
    if (!new RegExp(`(^|[\\s,])${f[1]}(?![a-z0-9-])`, "m").test(text)) {
      problems.push(`skillforge ${path.join(" ")}: no flag ${f[1]}`);
    }
  }
  return { path, problems };
}

test("skillforge command flags from the documents are present in --help", () => {
  assert.ok(existsSync(CLI), "build required: npm run build");
  const bad = new Set();
  let checked = 0;
  for (const rel of DOCS) {
    for (const s of codeSnippets(readFileSync(join(ROOT, ...rel.split("/")), "utf8"))) {
      for (const inv of invocations(s)) {
        checked += 1;
        for (const p of check(inv).problems) bad.add(`${rel}: ${p}  ← \`skillforge ${inv.slice(0, 80)}\``);
      }
    }
  }
  assert.ok(checked > 50, `too few commands checked: ${checked}`);
  assert.deepEqual([...bad], []);
});

test("the oracle distinguishes: a nonexistent flag is caught, an existing one is not", () => {
  assert.deepEqual(check("sync --dry-run").problems, ["skillforge sync: no flag --dry-run"]);
  assert.deepEqual(check("install skill/pdf-tools --runtime codex --scope user").problems, []);
  assert.deepEqual(check("agent scan --runtime qwen --name q").path, ["agent", "scan"]);
  assert.deepEqual(invocations("codex mcp add skillforge --url http://h/mcp"), [], "server name is not a command");
  assert.deepEqual(invocations("claude mcp add skillforge -- skillforge mcp"), ["mcp"]);
});
