import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RUNTIMES,
  RUNTIME_IDS,
  isRuntimeId,
  runtimeDef,
  runtimeScopes,
  runtimeSupport,
} from "../src/runtimes/table.ts";
import {
  splitCommand,
  tomlBasicString,
  tomlMultilineString,
  toGeminiToml,
  toOpenCodeMarkdown,
  toCursorMarkdown,
  translateCommand,
} from "../src/runtimes/translate.ts";

const ESC: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function decodeBasic(raw: string): string {
  return raw.replace(/\\(["\\bfnrt]|u[0-9A-Fa-f]{4})/g, (_, c: string) =>
    c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ESC[c]!,
  );
}

/** Decodes the TOML string forms emitted by the translator (basic, multi-line basic, multi-line literal). */
function decodeTomlString(token: string): string {
  if (token.startsWith("'''")) return token.slice(3, -3).replace(/^\r?\n/, "");
  if (token.startsWith('"""')) return decodeBasic(token.slice(3, -3).replace(/^\r?\n/, ""));
  assert.ok(token.startsWith('"') && token.endsWith('"'), token);
  return decodeBasic(token.slice(1, -1));
}

function parseGemini(toml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /^(\w+) = ('''[\s\S]*?'''(?=\n|$)|"""[\s\S]*?(?<!\\)"""(?=\n|$)|"(?:[^"\\\n]|\\.)*")/gm;
  for (const m of toml.matchAll(re)) out[m[1]!] = decodeTomlString(m[2]!);
  return out;
}

const COMMAND = `---\ndescription: Summarizes the given file for a changelog entry.\nargument-hint: <file>\nallowed-tools: Read\n---\n\nSummarize $ARGUMENTS in one line. Keep "quotes" and a backslash \\ intact.\n`;

test("RUNTIMES: order, dirs, scopes", () => {
  assert.deepEqual(RUNTIME_IDS, [
    "claude-code",
    "codex",
    "gemini",
    "cursor",
    "opencode",
    "qwen",
    "devin",
    "reckon",
  ]);
  assert.deepEqual(
    RUNTIMES.map((r) => [r.id, r.project_dir, r.user_dir]),
    [
      ["claude-code", ".claude", ".claude"],
      ["codex", ".codex", ".codex"],
      ["gemini", ".gemini", ".gemini"],
      ["cursor", ".cursor", ".cursor"],
      ["opencode", ".opencode", ".config/opencode"],
      ["qwen", ".qwen", ".qwen"],
      ["devin", ".agents", null],
      ["reckon", ".reckon", null],
    ],
  );
  for (const r of RUNTIMES) assert.match(r.docs_url, /^https:\/\//);
  for (const id of ["devin", "reckon"] as const)
    assert.deepEqual(runtimeScopes(runtimeDef(id)), ["project"]);
  assert.deepEqual(runtimeScopes(runtimeDef("codex")), ["project", "user"]);
  assert.equal(isRuntimeId("vim"), false);
  assert.equal(isRuntimeId("gemini"), true);
});

test("runtimeSupport: methods and reasons", () => {
  const cc = runtimeDef("claude-code");
  assert.deepEqual(runtimeSupport(cc, "agent"), { supported: true, method: "files" });
  assert.deepEqual(runtimeSupport(cc, "hook"), { supported: true, method: "plugin" });
  assert.deepEqual(runtimeSupport(cc, "settings"), { supported: true, method: "settings" });
  for (const id of RUNTIME_IDS) {
    assert.deepEqual(runtimeSupport(runtimeDef(id), "skill"), { supported: true, method: "files" });
  }
  for (const id of ["codex", "devin", "reckon"] as const) {
    const s = runtimeSupport(runtimeDef(id), "command");
    assert.equal(s.supported, false);
    if (!s.supported) {
      assert.match(s.reason, new RegExp(`not supported by ${id}`));
      assert.match(s.reason, /publish it as a skill/);
    }
  }
  assert.deepEqual(runtimeSupport(runtimeDef("gemini"), "command"), {
    supported: true,
    method: "gemini-toml",
  });
  assert.deepEqual(runtimeSupport(runtimeDef("cursor"), "command", "project"), {
    supported: true,
    method: "cursor-md",
  });
  const cursorUser = runtimeSupport(runtimeDef("cursor"), "command", "user");
  assert.equal(cursorUser.supported, false);
  const devinUser = runtimeSupport(runtimeDef("devin"), "skill", "user");
  assert.equal(devinUser.supported, false);
  assert.deepEqual(runtimeSupport(runtimeDef("qwen"), "command"), {
    supported: true,
    method: "qwen-md",
  });
  const agentMethods = [
    ["codex", "codex-toml"],
    ["opencode", "opencode-agent"],
    ["cursor", "cursor-agent"],
    ["qwen", "files"],
  ] as const;
  for (const [id, method] of agentMethods) {
    for (const scope of ["project", "user"] as const)
      assert.deepEqual(
        runtimeSupport(runtimeDef(id), "agent", scope),
        { supported: true, method },
        `${id} ${scope}`,
      );
  }
  for (const id of ["devin", "reckon"] as const)
    assert.equal(runtimeSupport(runtimeDef(id), "agent").supported, false);
  for (const type of ["agent", "hook", "plugin", "settings"] as const) {
    const s = runtimeSupport(runtimeDef("gemini"), type);
    assert.equal(s.supported, false, type);
    if (!s.supported) assert.match(s.reason, /not supported by gemini/);
  }
});

test("TOML: basic string escaping round-trips quotes, backslashes and control characters", () => {
  const value = 'He said "hi" \\ path C:\\dir\ttab\nline\u0001';
  const encoded = tomlBasicString(value);
  assert.ok(!encoded.slice(1, -1).includes("\n"));
  assert.equal(decodeTomlString(encoded), value);
});

test("Gemini: description, prompt as literal string, $ARGUMENTS → {{args}}", () => {
  const t = toGeminiToml("summarize", COMMAND);
  assert.equal(t.path, "commands/summarize.toml");
  assert.deepEqual(t.warnings, []);
  assert.match(t.content, /^prompt = '''\n/m);
  const parsed = parseGemini(t.content);
  assert.equal(parsed.description, "Summarizes the given file for a changelog entry.");
  assert.equal(
    parsed.prompt,
    '\nSummarize {{args}} in one line. Keep "quotes" and a backslash \\ intact.\n',
  );
});

test("Gemini: description with quotes is escaped", () => {
  const t = toGeminiToml("q", `---\ndescription: 'Say "hello" \\ now'\n---\nbody\n`);
  assert.equal(parseGemini(t.content).description, 'Say "hello" \\ now');
});

test("Gemini: ''' in text switches to escaped basic multi-line string", () => {
  const body =
    "Use '''triple''' quotes, \"\"\"doubles\"\"\" and a \\ backslash.\nEnds with quote'\n";
  const t = toGeminiToml("tq", `---\ndescription: d\n---\n${body}`);
  assert.match(t.content, /^prompt = """\n/m);
  assert.equal(parseGemini(t.content).prompt, body);
  assert.equal(decodeTomlString(tomlMultilineString("ends with '")), "ends with '");
});

test("Gemini: positional $1…$9 kept with a warning", () => {
  const t = toGeminiToml("pos", "Compare $1 with $2 and $1.\n");
  assert.equal(parseGemini(t.content).prompt, "Compare $1 with $2 and $1.\n");
  assert.equal(t.warnings.length, 1);
  assert.match(t.warnings[0]!, /\$1, \$2/);
});

test("no frontmatter: whole text is the body; Gemini omits description", () => {
  const text = "Just do $ARGUMENTS.\n";
  assert.deepEqual(splitCommand(text), { description: null, body: text });
  const g = parseGemini(toGeminiToml("plain", text).content);
  assert.equal(g.description, undefined);
  assert.equal(g.prompt, "Just do {{args}}.\n");
  assert.equal(toOpenCodeMarkdown("plain", text).content, text);
  assert.equal(toCursorMarkdown("plain", text).content, text);
});

test("OpenCode: frontmatter only description; body preserved character by character", () => {
  const t = toOpenCodeMarkdown("summarize", COMMAND);
  assert.equal(t.path, "commands/summarize.md");
  assert.equal(
    t.content,
    `---\ndescription: Summarizes the given file for a changelog entry.\n---\n\nSummarize $ARGUMENTS in one line. Keep "quotes" and a backslash \\ intact.\n`,
  );
});

test("Cursor: body only, exact characters (CRLF, unicode, trailing whitespace)", () => {
  const body = "Line one — «ünïcödé» · →  \r\n\tindented $ARGUMENTS\r\n\r\n";
  const t = toCursorMarkdown("c", `---\r\ndescription: x\r\n---\r\n${body}`);
  assert.equal(t.content, body);
  assert.equal(splitCommand(`---\ndescription: x\n---\n${body}`).body, body);
  const g = parseGemini(toGeminiToml("c", `---\r\ndescription: x\r\n---\r\n${body}`).content);
  assert.equal(g.prompt, body.replace("$ARGUMENTS", "{{args}}"));
});

test("translateCommand: files keeps Claude Code command as is", () => {
  assert.deepEqual(translateCommand("files", "summarize", COMMAND), {
    path: "commands/summarize.md",
    content: COMMAND,
    warnings: [],
  });
  assert.equal(translateCommand("cursor-md", "s", COMMAND).path, "commands/s.md");
  assert.equal(translateCommand("gemini-toml", "s", COMMAND).path, "commands/s.toml");
});
