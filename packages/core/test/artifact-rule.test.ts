// rule-artifacts: the `rule` type — one rules/<name>.md with name, description, optional paths and tags; detection by
// the rules/ directory; quality and context cost of a rule; installation translation for Cursor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ARTIFACT_TYPES, detectArtifactType, parseArtifact } from "../src/artifact/index.ts";
import { ISSUE_CODES } from "../src/artifact/types.ts";
import { assessQuality } from "../src/quality/assess.ts";
import { RUNTIMES, runtimeSupport } from "../src/runtimes/table.ts";
import { translateRule } from "../src/runtimes/rules.ts";

const md = (fm: string, body = "Never write secrets, tokens or passwords to logs.\n") =>
  `---\n${fm}\n---\n\n${body}`;
const ALWAYS = md(
  "name: no-secrets-in-logs\ndescription: Keeps secrets out of logs.\ntags: [security]",
);
const SCOPED = md(
  'name: api-style\ndescription: Style of the API handlers.\npaths:\n  - "src/api/**/*.ts"\n  - "tests/api/**"',
  "Validate input at the boundary and return typed errors.\n",
);
const file = (path: string, text: string) => ({ path, content: Buffer.from(text) });
const parse = (files: Array<{ path: string; content: Buffer }>) =>
  parseArtifact({ type: "rule", files });
const codes = (r: ReturnType<typeof parse>) => (r.ok ? [] : r.errors.map((e) => e.code));

test("the type table ends with rule", () => {
  const last = ARTIFACT_TYPES.at(-1)!;
  assert.equal(last.id, "rule");
  assert.equal(last.label, "Rule");
  assert.equal(last.plural, "Rules");
  assert.equal(last.mainFile("api-style"), "rules/api-style.md");
});

test("an always-on rule", () => {
  const r = parse([file("no-secrets-in-logs.md", ALWAYS)]);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.artifact.type, "rule");
  assert.equal(r.artifact.name, "no-secrets-in-logs");
  assert.deepEqual(
    r.artifact.files.map((f) => f.path),
    ["rules/no-secrets-in-logs.md"],
  );
  assert.equal(r.artifact.frontmatter?.paths, undefined);
  assert.deepEqual(r.artifact.tags, ["security"]);
});

test("a rule for part of the files keeps its paths in order", () => {
  const r = parse([file("rules/api-style.md", SCOPED)]);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.deepEqual(r.artifact.frontmatter?.paths, ["src/api/**/*.ts", "tests/api/**"]);
  assert.deepEqual(
    r.artifact.files.map((f) => f.path),
    ["rules/api-style.md"],
  );
});

test("errors of a rule, and none of them falls back to a command", () => {
  const cases: Array<[Array<{ path: string; content: Buffer }>, string]> = [
    [
      [file("a.md", md('name: a-rule\ndescription: A rule.\npaths: "src/**"'))],
      ISSUE_CODES.E_RULE_PATHS_INVALID,
    ],
    [
      [file("a.md", md("name: a-rule\ndescription: A rule.\npaths: []"))],
      ISSUE_CODES.E_RULE_PATHS_INVALID,
    ],
    [
      [file("a.md", md('name: a-rule\ndescription: A rule.\npaths: ["", "src/**"]'))],
      ISSUE_CODES.E_RULE_PATHS_INVALID,
    ],
    [[file("a.md", ALWAYS), file("notes.txt", "x")], ISSUE_CODES.E_RULE_EXTRA_FILE],
    [[file("a.md", "Just text, no frontmatter.\n")], ISSUE_CODES.E_FRONTMATTER_MISSING],
  ];
  for (const [files, code] of cases) {
    const r = parse(files);
    assert.equal(r.ok, false, code);
    assert.ok(codes(r).includes(code as never), `${code}: ${JSON.stringify(codes(r))}`);
  }
});

test("detection by the rules/ directory", () => {
  assert.equal(detectArtifactType([file("rules/no-secrets-in-logs.md", ALWAYS)]), "rule");
  assert.equal(detectArtifactType([file("team/rules/api-style.md", SCOPED)]), "rule");
  assert.equal(detectArtifactType([file("commands/review.md", "Review the diff.\n")]), "command");
});

test("context cost: an always-on rule costs every turn, a scoped one on use; a long always-on rule is refused", () => {
  const always = parse([file("a.md", ALWAYS)]);
  const scoped = parse([file("b.md", SCOPED)]);
  assert.ok(always.ok && scoped.ok);
  if (!always.ok || !scoped.ok) return;
  const qa = assessQuality(always.artifact);
  assert.ok(qa.context.every_turn > 0);
  assert.equal(qa.context.on_use, 0);
  assert.equal(qa.context.on_demand, 0);
  const qs = assessQuality(scoped.artifact);
  assert.equal(qs.context.every_turn, 0);
  assert.ok(qs.context.on_use > 0);

  const long = "Never log secrets. ".repeat(450); // ≈ 2000 tokens
  const tooLong = parse([file("c.md", md("name: long-rule\ndescription: A long rule.", long))]);
  assert.equal(tooLong.ok, false);
  assert.ok(
    codes(tooLong).includes(ISSUE_CODES.E_RULE_ALWAYS_LONG as never),
    JSON.stringify(codes(tooLong)),
  );
  const longScoped = parse([
    file(
      "d.md",
      md('name: long-scoped\ndescription: A long scoped rule.\npaths: ["src/**"]', long),
    ),
  ]);
  assert.equal(longScoped.ok, true, "a scoped rule has no length gate");
});

test("skill heuristics do not apply to a rule", () => {
  const r = parse([file("a.md", ALWAYS)]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const ids = assessQuality(r.artifact).checks.map((c) => c.code);
  for (const skillOnly of ["Q_DESC_NO_TRIGGER", "Q_DESC_NO_BOUNDARY", "Q_NO_EXAMPLE"]) {
    assert.ok(!ids.includes(skillOnly as never), `${skillOnly} applied to a rule`);
  }
});

test("runtimes: Claude Code as files in both scopes, Cursor translated in the project, the rest refused with a reason", () => {
  const def = (id: string) => RUNTIMES.find((r) => r.id === id)!;
  assert.deepEqual(runtimeSupport(def("claude-code"), "rule", "project"), {
    supported: true,
    method: "files",
  });
  assert.deepEqual(runtimeSupport(def("claude-code"), "rule", "user"), {
    supported: true,
    method: "files",
  });
  assert.deepEqual(runtimeSupport(def("cursor"), "rule", "project"), {
    supported: true,
    method: "cursor-rule",
  });
  assert.equal(runtimeSupport(def("cursor"), "rule", "user").supported, false);
  for (const [id, file] of [
    ["codex", "AGENTS.md"],
    ["gemini", "GEMINI.md"],
    ["qwen", "QWEN.md"],
  ] as const) {
    const s = runtimeSupport(def(id), "rule", "project");
    assert.equal(s.supported, false, id);
    assert.ok(!s.supported && s.reason.includes(file), `${id}: ${JSON.stringify(s)}`);
  }
  for (const id of ["opencode", "devin", "reckon"])
    assert.equal(runtimeSupport(def(id), "rule", "project").supported, false, id);
});

test("Cursor translation: .mdc with description, globs and alwaysApply; body unchanged", () => {
  const scoped = translateRule("api-style", SCOPED);
  assert.equal(scoped.path, "rules/api-style.mdc");
  assert.match(
    scoped.content,
    /^---\ndescription: Style of the API handlers\.\nglobs: src\/api\/\*\*\/\*\.ts,tests\/api\/\*\*\nalwaysApply: false\n---\n/,
  );
  assert.ok(scoped.content.endsWith("Validate input at the boundary and return typed errors.\n"));
  const always = translateRule("no-secrets-in-logs", ALWAYS);
  assert.match(always.content, /\nalwaysApply: true\n/);
  assert.doesNotMatch(always.content, /globs:/);
  assert.doesNotMatch(always.content, /name:|tags:/);
});
