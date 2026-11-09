// Translation of Claude Code agents to Codex (TOML), OpenCode and Cursor (trimmed frontmatter), and of commands to Qwen Code
// ({{args}}). The TOML oracle is `smol-toml`, the YAML oracle is `yaml`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import {
  toCodexAgentToml,
  toOpenCodeAgent,
  toCursorAgent,
  translateAgent,
} from "../src/runtimes/agents.ts";
import { toQwenMarkdown, translateCommand } from "../src/runtimes/translate.ts";

const DESCRIPTION = 'Reviews "diffs" with a \\ backslash.';
const BODIES = [
  "Plain body.\n",
  "Keep ''' and \"\"\" and a backslash \\ and $ARGUMENTS intact.\nEnds with quote'\n",
  "CRLF body — «ünïcödé»\r\n\tindented\r\n\r\n",
  'Ends with triple double quotes """',
];

function agent(
  body: string,
  extra = "tools: Read, Grep, Bash\nmodel: sonnet\ncolor: blue\n",
): string {
  return `---\nname: reviewer\ndescription: '${DESCRIPTION}'\n${extra}---\n${body}`;
}

function splitMd(text: string): { fm: unknown; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, `no frontmatter: ${JSON.stringify(text)}`);
  return { fm: parseYaml(m[1]!), body: m[2]! };
}

test("Codex: TOML with exactly name, description, developer_instructions; body exact", () => {
  for (const body of BODIES) {
    const t = toCodexAgentToml("reviewer", agent(body));
    assert.equal(t.path, "agents/reviewer.toml");
    const parsed = parseToml(t.content);
    assert.deepEqual(Object.keys(parsed).sort(), ["description", "developer_instructions", "name"]);
    assert.equal(parsed.name, "reviewer");
    assert.equal(parsed.description, DESCRIPTION);
    assert.equal(parsed.developer_instructions, body, JSON.stringify(body));
  }
});

test("Codex: dropped keys named in one warning", () => {
  const t = toCodexAgentToml("reviewer", agent("b\n"));
  assert.equal(t.warnings.length, 1);
  assert.match(t.warnings[0]!, /^agent reviewer: dropped .*\(not supported by codex\)$/);
  for (const key of ["tools", "model", "color"]) assert.ok(t.warnings[0]!.includes(key), key);
  assert.deepEqual(
    toCodexAgentToml("reviewer", agent("b\n", "")).warnings,
    [],
    "nothing dropped — no warning",
  );
});

test("OpenCode: frontmatter exactly description + mode subagent; body exact; name dropped too", () => {
  for (const body of BODIES) {
    const t = toOpenCodeAgent("reviewer", agent(body));
    assert.equal(t.path, "agents/reviewer.md");
    const { fm, body: got } = splitMd(t.content);
    assert.deepEqual(fm, { description: DESCRIPTION, mode: "subagent" });
    assert.equal(got, body);
    assert.equal(t.warnings.length, 1);
    for (const key of ["name", "tools", "model", "color"])
      assert.ok(t.warnings[0]!.includes(key), key);
    assert.match(t.warnings[0]!, /not supported by opencode/);
  }
});

test("Cursor: frontmatter exactly name + description; body exact", () => {
  for (const body of BODIES) {
    const t = toCursorAgent("reviewer", agent(body));
    assert.equal(t.path, "agents/reviewer.md");
    const { fm, body: got } = splitMd(t.content);
    assert.deepEqual(fm, { name: "reviewer", description: DESCRIPTION });
    assert.equal(got, body);
    assert.match(t.warnings[0]!, /not supported by cursor/);
  }
});

test("translateAgent: files keeps the agent as is; methods dispatch", () => {
  const text = agent("b\n");
  assert.deepEqual(translateAgent("files", "reviewer", text), {
    path: "agents/reviewer.md",
    content: text,
    warnings: [],
  });
  assert.equal(translateAgent("codex-toml", "reviewer", text).path, "agents/reviewer.toml");
  assert.equal(translateAgent("opencode-agent", "reviewer", text).path, "agents/reviewer.md");
  assert.equal(translateAgent("cursor-agent", "reviewer", text).path, "agents/reviewer.md");
});

test("Qwen Code command: frontmatter only description, $ARGUMENTS → {{args}}, $1 warning, body otherwise exact", () => {
  const cmd = `---\ndescription: Summarizes the file.\nargument-hint: <file>\nallowed-tools: Read\n---\nSummarize $ARGUMENTS, compare $1. Keep "q" \\ intact.\r\n`;
  const t = toQwenMarkdown("summarize", cmd);
  assert.equal(t.path, "commands/summarize.md");
  const { fm, body } = splitMd(t.content);
  assert.deepEqual(fm, { description: "Summarizes the file." });
  assert.equal(body, `Summarize {{args}}, compare $1. Keep "q" \\ intact.\r\n`);
  assert.equal(t.warnings.length, 1);
  assert.match(t.warnings[0]!, /\$1/);
  assert.deepEqual(translateCommand("qwen-md", "summarize", cmd), t);
  assert.equal(
    toQwenMarkdown("plain", "Just $ARGUMENTS.\n").content,
    "Just {{args}}.\n",
    "no frontmatter — body only",
  );
});
