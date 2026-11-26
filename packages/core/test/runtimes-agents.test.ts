// Translation of Claude Code agents to Codex (TOML), OpenCode, Cursor and Qwen Code (trimmed frontmatter), and of commands
// to Qwen Code ({{args}}). The TOML oracle is `smol-toml`, the YAML oracle is `yaml`.
// agent-restrictions-translation: the edit, shell and network restrictions of an agent (`tools`, `disallowedTools`,
// `readonly`) reach each agent in its own mechanism, or the translation reports them as not enforced. The expected
// formats follow what the real clients reported (design of the change) and what sdlc 0.34.1 writes for the same role
// (`sdlc/dist/integrations`: OpenCode `permission`, Codex `sandbox_mode = "read-only"`, Cursor `readonly: true`, Qwen
// `disallowedTools: [write_file, edit]`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import {
  toCodexAgentToml,
  toOpenCodeAgent,
  toCursorAgent,
  toQwenAgent,
  toolRestrictions,
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
/** Claude-only keys that carry no restriction. */
const PLAIN = "model: sonnet\ncolor: blue\n";
/** The sdlc 0.34.1 reviewer role as the registry stores it (shape of assets/roles/en/reviewer.md plus name and tags). */
const SDLC_REVIEWER =
  "id: reviewer\ntitle: Reviewer\nstages: [deploy]\ntools: [read, grep, glob, bash]\nreadonly: true\nskills: [code-that-fits-in-your-head]\ntags: [sdlc-role]\n";

function agent(body: string, extra = PLAIN): string {
  return `---\nname: reviewer\ndescription: '${DESCRIPTION}'\n${extra}---\n${body}`;
}

function splitMd(text: string): { fm: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, `no frontmatter: ${JSON.stringify(text)}`);
  return { fm: parseYaml(m[1]!) as Record<string, unknown>, body: m[2]! };
}

test("Codex: an agent without restrictions — TOML with exactly name, description, developer_instructions; body exact", () => {
  for (const body of BODIES) {
    const t = toCodexAgentToml("reviewer", agent(body));
    assert.equal(t.path, "agents/reviewer.toml");
    const parsed = parseToml(t.content);
    assert.deepEqual(Object.keys(parsed).sort(), ["description", "developer_instructions", "name"]);
    assert.equal(parsed.name, "reviewer");
    assert.equal(parsed.description, DESCRIPTION);
    assert.equal(parsed.developer_instructions, body, JSON.stringify(body));
    assert.deepEqual(t.unenforced, []);
  }
});

test("Codex: dropped keys named in one warning", () => {
  const t = toCodexAgentToml("reviewer", agent("b\n", `tools: Read, Grep, Bash\n${PLAIN}`));
  assert.equal(t.warnings.length, 1);
  assert.match(t.warnings[0]!, /^agent reviewer: dropped .*\(not supported by codex\)$/);
  for (const key of ["tools", "model", "color"]) assert.ok(t.warnings[0]!.includes(key), key);
  assert.deepEqual(
    toCodexAgentToml("reviewer", agent("b\n", "")).warnings,
    [],
    "nothing dropped — no warning",
  );
});

test("OpenCode: an agent without restrictions — frontmatter exactly description + mode subagent; body exact", () => {
  for (const body of BODIES) {
    const t = toOpenCodeAgent("reviewer", agent(body));
    assert.equal(t.path, "agents/reviewer.md");
    const { fm, body: got } = splitMd(t.content);
    assert.deepEqual(fm, { description: DESCRIPTION, mode: "subagent" });
    assert.equal(got, body);
    assert.equal(t.warnings.length, 1);
    for (const key of ["name", "model", "color"]) assert.ok(t.warnings[0]!.includes(key), key);
    assert.match(t.warnings[0]!, /not supported by opencode/);
    assert.deepEqual(t.unenforced, []);
  }
});

test("Cursor: an agent without restrictions — frontmatter exactly name + description; body exact", () => {
  for (const body of BODIES) {
    const t = toCursorAgent("reviewer", agent(body));
    assert.equal(t.path, "agents/reviewer.md");
    const { fm, body: got } = splitMd(t.content);
    assert.deepEqual(fm, { name: "reviewer", description: DESCRIPTION });
    assert.equal(got, body);
    assert.match(t.warnings[0]!, /not supported by cursor/);
    assert.deepEqual(t.unenforced, []);
  }
});

test("Qwen Code: an agent without restrictions — frontmatter exactly name + description; body exact", () => {
  for (const body of BODIES) {
    const t = toQwenAgent("reviewer", agent(body));
    assert.equal(t.path, "agents/reviewer.md");
    const { fm, body: got } = splitMd(t.content);
    assert.deepEqual(fm, { name: "reviewer", description: DESCRIPTION });
    assert.equal(got, body);
    assert.match(t.warnings[0]!, /not supported by qwen/);
    assert.deepEqual(t.unenforced, []);
  }
});

test("translateAgent: files keeps the agent as is; methods dispatch", () => {
  const text = agent("b\n");
  assert.deepEqual(translateAgent("files", "reviewer", text), {
    path: "agents/reviewer.md",
    content: text,
    warnings: [],
    unenforced: [],
  });
  assert.equal(translateAgent("codex-toml", "reviewer", text).path, "agents/reviewer.toml");
  assert.equal(translateAgent("opencode-agent", "reviewer", text).path, "agents/reviewer.md");
  assert.equal(translateAgent("cursor-agent", "reviewer", text).path, "agents/reviewer.md");
  assert.equal(translateAgent("qwen-agent", "reviewer", text).path, "agents/reviewer.md");
});

// --- Tool restrictions -------------------------------------------------------------------------------------------

const NONE = { edit: false, shell: false, network: false };
const fm = (extra: string) => splitMd(agent("b\n", extra)).fm;

test("restrictions: tools is an allow-list in the vocabularies of Claude Code, sdlc and Qwen, case-insensitive", () => {
  assert.deepEqual(toolRestrictions(fm(PLAIN)), NONE, "no tools — nothing forbidden");
  assert.deepEqual(toolRestrictions(fm("tools: Read, Grep, Bash\n")), {
    edit: true,
    shell: false,
    network: true,
  });
  assert.deepEqual(toolRestrictions(fm("tools: [read, grep, glob, bash]\n")), {
    edit: true,
    shell: false,
    network: true,
  });
  assert.deepEqual(toolRestrictions(fm("tools: [read_file, run_shell_command, web_fetch]\n")), {
    edit: true,
    shell: false,
    network: false,
  });
  assert.deepEqual(
    toolRestrictions(fm("tools: Bash, PowerShell, Write, Read, Glob, Grep\n")),
    { edit: false, shell: false, network: true },
    "the handoff-executor fixture: Write allows editing, PowerShell is a shell",
  );
  assert.deepEqual(toolRestrictions(fm("tools: Read, Edit, WebFetch\n")), {
    edit: false,
    shell: true,
    network: false,
  });
  assert.deepEqual(
    toolRestrictions(fm('tools: ["Bash(git log:*)", Read, mcp__codegraph__explore]\n')),
    { edit: true, shell: false, network: true },
    "a Claude Code rule pattern names its tool; an MCP tool is no class",
  );
});

test("restrictions: disallowedTools forbids a class; readonly forbids editing", () => {
  assert.deepEqual(toolRestrictions(fm("disallowedTools: Edit, Write\n")), {
    edit: true,
    shell: false,
    network: false,
  });
  assert.deepEqual(toolRestrictions(fm("disallowedTools: [web_fetch]\n")), {
    edit: false,
    shell: false,
    network: true,
  });
  assert.deepEqual(toolRestrictions(fm("readonly: true\n")), {
    edit: true,
    shell: false,
    network: false,
  });
  assert.deepEqual(toolRestrictions(fm("readonly: false\n")), NONE);
  assert.deepEqual(toolRestrictions(fm(SDLC_REVIEWER)), {
    edit: true,
    shell: false,
    network: true,
  });
  assert.deepEqual(toolRestrictions(null), NONE);
});

test("OpenCode: the sdlc reviewer gets permission edit and webfetch deny, bash stays allowed (as sdlc writes it)", () => {
  const t = toOpenCodeAgent("reviewer", agent("b\n", SDLC_REVIEWER));
  const { fm: got, body } = splitMd(t.content);
  assert.deepEqual(got, {
    description: DESCRIPTION,
    mode: "subagent",
    permission: { edit: "deny", webfetch: "deny" },
  });
  assert.equal(body, "b\n");
  assert.deepEqual(t.unenforced, []);
  const noShell = splitMd(
    toOpenCodeAgent("reviewer", agent("b\n", "tools: [read, grep]\n")).content,
  ).fm;
  assert.deepEqual(noShell.permission, { edit: "deny", bash: "deny", webfetch: "deny" });
});

test("Codex: read-only sandbox for editing, web search disabled for network; a shell restriction is not enforced", () => {
  const t = toCodexAgentToml("reviewer", agent("b\n", SDLC_REVIEWER));
  const parsed = parseToml(t.content);
  assert.equal(parsed.sandbox_mode, "read-only");
  assert.equal(parsed.web_search, "disabled");
  assert.equal(parsed.developer_instructions, "b\n");
  assert.deepEqual(t.unenforced, []);
  const noShell = toCodexAgentToml("reviewer", agent("b\n", "tools: [read, grep]\n"));
  assert.deepEqual(noShell.unenforced, ["shell"]);
  const editOnly = parseToml(
    toCodexAgentToml("reviewer", agent("b\n", "readonly: true\n")).content,
  );
  assert.equal(editOnly.sandbox_mode, "read-only");
  assert.equal(editOnly.web_search, undefined, "network is not forbidden — no web_search key");
});

test("Cursor: readonly for editing; network and shell restrictions are not enforced", () => {
  const t = toCursorAgent("reviewer", agent("b\n", SDLC_REVIEWER));
  assert.deepEqual(splitMd(t.content).fm, {
    name: "reviewer",
    description: DESCRIPTION,
    readonly: true,
  });
  assert.deepEqual(t.unenforced, ["network"]);
  assert.deepEqual(toCursorAgent("reviewer", agent("b\n", "tools: [read]\n")).unenforced, [
    "shell",
    "network",
  ]);
  assert.deepEqual(toCursorAgent("reviewer", agent("b\n", "readonly: true\n")).unenforced, []);
});

test("Qwen Code: disallowedTools in Qwen names; the Claude/sdlc tools list is dropped", () => {
  const t = toQwenAgent("reviewer", agent("b\n", SDLC_REVIEWER));
  const { fm: got } = splitMd(t.content);
  assert.deepEqual(got, {
    name: "reviewer",
    description: DESCRIPTION,
    disallowedTools: ["edit", "write_file", "web_fetch", "web_search"],
  });
  assert.deepEqual(t.unenforced, []);
  assert.match(t.warnings[0]!, /tools/);
  const noShell = splitMd(
    toQwenAgent("reviewer", agent("b\n", "tools: [read, grep]\n")).content,
  ).fm;
  assert.deepEqual(noShell.disallowedTools, [
    "edit",
    "write_file",
    "run_shell_command",
    "exec",
    "web_fetch",
    "web_search",
  ]);
});

test("Claude Code: as is; editing forbidden only by readonly (which Claude Code does not apply) is not enforced", () => {
  const onlyReadonly = agent("b\n", "readonly: true\n");
  const t = translateAgent("files", "reviewer", onlyReadonly);
  assert.equal(t.content, onlyReadonly, "the file stays as is");
  assert.deepEqual(t.unenforced, ["edit"]);
  assert.deepEqual(
    translateAgent("files", "reviewer", agent("b\n", SDLC_REVIEWER)).unenforced,
    [],
    "tools carries it",
  );
  assert.deepEqual(
    translateAgent(
      "files",
      "reviewer",
      agent("b\n", "readonly: true\ndisallowedTools: Edit, Write\n"),
    ).unenforced,
    [],
  );
  assert.deepEqual(
    translateAgent("files", "reviewer", agent("b\n", "readonly: true\ntools: Read, Edit\n"))
      .unenforced,
    ["edit"],
  );
});

test("Qwen Code command: frontmatter only description, $ARGUMENTS → {{args}}, $1 warning, body otherwise exact", () => {
  const cmd = `---\ndescription: Summarizes the file.\nargument-hint: <file>\nallowed-tools: Read\n---\nSummarize $ARGUMENTS, compare $1. Keep "q" \\ intact.\r\n`;
  const t = toQwenMarkdown("summarize", cmd);
  assert.equal(t.path, "commands/summarize.md");
  const { fm: got, body } = splitMd(t.content);
  assert.deepEqual(got, { description: "Summarizes the file." });
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
