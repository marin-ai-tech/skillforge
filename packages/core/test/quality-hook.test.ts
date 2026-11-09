import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArtifact } from "../src/artifact/index.ts";
import type { ParsedArtifact } from "../src/artifact/types.ts";
import { assessQuality, HOOK_RUNTIMES } from "../src/quality/index.ts";
import type { HookRiskLabel, HookRow, QualityCode, QualityReport } from "../src/quality/index.ts";
import { cleanHookText, truncateAction } from "../src/quality/hook.ts";

type Handler = Record<string, unknown>;
type Group = { matcher?: string; hooks: Handler[] };
type Hooks = Record<string, Group[]>;

const README = "# demo\n\nGuards things. Use when guarding.\n";

function hook(hooks: Hooks, scripts: Record<string, string> = {}): ParsedArtifact {
  const r = parseArtifact({
    type: "hook",
    files: [
      { path: "demo/hooks.json", content: JSON.stringify({ hooks }) },
      { path: "demo/README.md", content: README },
      ...Object.entries(scripts).map(([path, content]) => ({ path: `demo/${path}`, content })),
    ],
  });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.artifact;
}

const cmd = (command: string, timeout: number | null = 5): Handler =>
  timeout === null ? { type: "command", command } : { type: "command", command, timeout };
const SCRIPT_CMD = '"${CLAUDE_PLUGIN_ROOT}"/scripts/run.sh';

const codes = (q: QualityReport): QualityCode[] =>
  q.checks.map((c) => c.code).filter((c) => c.startsWith("Q_HOOK_"));
const has = (q: QualityReport, code: QualityCode) => codes(q).includes(code);
const risk = (q: QualityReport, label: HookRiskLabel) =>
  q.hook!.risks.find((r) => r.label === label)?.rows ?? null;
const rows = (q: QualityReport): HookRow[] => q.hook!.rows;

test("HOOK_RUNTIMES: claude-code supports HOOK_EVENTS and the four handler types", () => {
  assert.equal(HOOK_RUNTIMES.length, 1);
  const cc = HOOK_RUNTIMES[0]!;
  assert.equal(cc.runtime, "claude-code");
  assert.ok(cc.events.includes("PreToolUse") && cc.events.includes("Stop"));
  assert.deepEqual([...cc.types], ["command", "http", "prompt", "agent"]);
});

test("rows: order of hooks.json, matcher normalisation, action per type, timeout, runtimes", () => {
  const q = assessQuality(
    hook({
      Stop: [{ hooks: [{ type: "agent", agent: "reviewer" }] }],
      PreToolUse: [
        { matcher: "", hooks: [cmd("echo a"), { type: "http", url: "https://x.example/h" }] },
        { matcher: "Bash", hooks: [{ type: "prompt", prompt: "Check it", timeout: 30 }] },
      ],
    }),
  );
  assert.equal(q.algorithm, 5);
  assert.deepEqual(rows(q), [
    {
      event: "Stop",
      matcher: null,
      type: "agent",
      action: "reviewer",
      timeout: null,
      script: null,
      blocking: "unknown",
      runtimes: ["claude-code"],
    },
    {
      event: "PreToolUse",
      matcher: null,
      type: "command",
      action: "echo a",
      timeout: 5,
      script: null,
      blocking: "none",
      runtimes: ["claude-code"],
    },
    {
      event: "PreToolUse",
      matcher: null,
      type: "http",
      action: "https://x.example/h",
      timeout: null,
      script: null,
      blocking: "unknown",
      runtimes: ["claude-code"],
    },
    {
      event: "PreToolUse",
      matcher: "Bash",
      type: "prompt",
      action: "Check it",
      timeout: 30,
      script: null,
      blocking: "unknown",
      runtimes: ["claude-code"],
    },
  ]);
});

test("rows: unknown event has no runtimes; unsupported handler types are skipped", () => {
  const q = assessQuality(
    hook({
      OnCoffee: [{ hooks: [cmd("echo a"), { type: "mcp_tool", server: "s", tool: "t" }] }],
    }),
  );
  assert.equal(rows(q).length, 1);
  assert.deepEqual(rows(q)[0]!.runtimes, []);
  assert.equal(rows(q)[0]!.blocking, "none");
});

test("action: longer than 200 characters is cut to 200 ending with …", () => {
  const long = "x".repeat(250);
  const q = assessQuality(hook({ SessionStart: [{ hooks: [cmd(long)] }] }));
  const action = rows(q)[0]!.action;
  assert.equal(action.length, 200);
  assert.ok(action.endsWith("…"));
  assert.equal(truncateAction("y".repeat(200)), "y".repeat(200));
  assert.equal(truncateAction("y".repeat(201)).length, 200);
});

test("script: canonical bundle path when the referenced file exists, null otherwise", () => {
  const withScript = assessQuality(
    hook(
      { PreToolUse: [{ matcher: "Bash", hooks: [cmd(SCRIPT_CMD)] }] },
      {
        "scripts/run.sh": "exit 0\n",
      },
    ),
  );
  assert.equal(rows(withScript)[0]!.script, "scripts/run.sh");
  const missing = assessQuality(
    hook({ PreToolUse: [{ matcher: "Bash", hooks: [cmd(SCRIPT_CMD)] }] }),
  );
  assert.equal(rows(missing)[0]!.script, null);
});

test("blocking: command on a blocking event by script or inline text", () => {
  const cases: Array<[string, string]> = [
    ["exit 2", "block"],
    ['echo \'{"decision":"block"}\'', "block"],
    ['echo \'{ "permissionDecision" : "deny" }\'', "block"],
    ['echo \'{"decision": "ask"}\'', "ask"],
    ['echo \'{"permissionDecision":"ask"}\'', "ask"],
    ["exit 0", "none"],
    ["exit 20", "none"],
  ];
  for (const [text, expected] of cases) {
    const inline = assessQuality(hook({ PreToolUse: [{ matcher: "Bash", hooks: [cmd(text)] }] }));
    assert.equal(rows(inline)[0]!.blocking, expected, `inline: ${text}`);
    const viaScript = assessQuality(
      hook({ UserPromptSubmit: [{ hooks: [cmd(SCRIPT_CMD)] }] }, { "scripts/run.sh": `${text}\n` }),
    );
    assert.equal(rows(viaScript)[0]!.blocking, expected, `script: ${text}`);
  }
  const blockAndAsk = assessQuality(
    hook({ Stop: [{ hooks: [cmd('echo \'{"decision":"ask"}\' || exit 2')] }] }),
  );
  assert.equal(rows(blockAndAsk)[0]!.blocking, "block", "block wins over ask");
});

test("blocking: script text wins over the inline command text", () => {
  const q = assessQuality(
    hook(
      { PreToolUse: [{ matcher: "Bash", hooks: [cmd(`${SCRIPT_CMD} || exit 2`)] }] },
      {
        "scripts/run.sh": "exit 0\n",
      },
    ),
  );
  assert.equal(rows(q)[0]!.blocking, "none");
});

test("blocking: http/prompt/agent are unknown on blocking events, none elsewhere", () => {
  for (const event of [
    "PreToolUse",
    "PermissionRequest",
    "UserPromptSubmit",
    "PostToolUse",
    "Stop",
    "SubagentStop",
  ]) {
    const q = assessQuality(
      hook({
        [event]: [
          {
            hooks: [
              { type: "http", url: "https://x.example", timeout: 1 },
              { type: "prompt", prompt: "p" },
              { type: "agent", agent: "a" },
            ],
          },
        ],
      }),
    );
    assert.deepEqual(
      rows(q).map((r) => r.blocking),
      ["unknown", "unknown", "unknown"],
      event,
    );
  }
  const q = assessQuality(
    hook({
      SessionStart: [
        {
          hooks: [
            cmd("exit 2"),
            { type: "http", url: "https://x.example", timeout: 1 },
            { type: "prompt", prompt: "p" },
            { type: "agent", agent: "a" },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(
    rows(q).map((r) => r.blocking),
    ["none", "none", "none", "none"],
    "SessionStart cannot block",
  );
  assert.equal(risk(q, "blocks_tools"), null);
  assert.ok(!has(q, "Q_HOOK_HARD_BLOCK"));
});

test("cleanHookText: drops comment lines and masks quoted string contents", () => {
  const raw = [
    "#!/usr/bin/env sh",
    "  # rm -rf / in a comment",
    'case "$input" in',
    '  *"rm -rf /"*) echo \'{"decision":"ask"}\'; exit 0;;',
    "esac",
    'x="a \\" b" # trailing comment stays',
  ].join("\n");
  const cleaned = cleanHookText(raw);
  assert.equal(
    cleaned,
    ['case "_" in', "  *\"_\"*) echo '_'; exit 0;;", "esac", 'x="_" # trailing comment stays'].join(
      "\n",
    ),
  );
  assert.ok(!cleaned.includes("rm -rf"));
});

test("writes_files: fires on redirections and write commands, not on >&, /dev/null, quotes, comments", () => {
  const fires = [
    'echo "$x" >> "$HOME/log"',
    "echo hi > out.txt",
    "2> err.log",
    "cat in | tee out",
    "rm -rf ./tmp",
    "mv a b",
    "cp a b",
    "sed -i 's/a/b/' f",
    "Set-Content -Path f -Value x",
    "Add-Content f x",
    "Out-File f",
    "Remove-Item f",
    "New-Item f",
    "fs.writeFileSync(p, d)",
  ];
  for (const text of fires) {
    const q = assessQuality(hook({ SessionStart: [{ hooks: [cmd(text)] }] }));
    assert.deepEqual(risk(q, "writes_files"), [0], text);
  }
  const silent = [
    "echo err >&2",
    "cmd 2>&1",
    "cmd >/dev/null 2>&1",
    "cmd > /dev/null",
    '[ "$a" -gt 1 ] && echo "rm -rf /"',
    "grep -q 'rm -rf|mv ' file",
    "test $a => 1; x -> y",
    "echo hi",
  ];
  for (const text of silent) {
    const q = assessQuality(hook({ SessionStart: [{ hooks: [cmd(text)] }] }));
    assert.equal(risk(q, "writes_files"), null, text);
  }
  const comment = assessQuality(
    hook(
      { SessionStart: [{ hooks: [cmd(SCRIPT_CMD)] }] },
      {
        "scripts/run.sh": "#!/bin/sh\n# rm -rf everything > out\necho ok\n",
      },
    ),
  );
  assert.equal(risk(comment, "writes_files"), null, "comment lines are ignored");
  const script = assessQuality(
    hook(
      { SessionStart: [{ hooks: [cmd(SCRIPT_CMD)] }] },
      {
        "scripts/run.sh": '#!/bin/sh\necho "$1" >> "$HOME/audit.log"\n',
      },
    ),
  );
  assert.deepEqual(risk(script, "writes_files"), [0]);
});

test("network: http type or network commands/URLs in cleaned text", () => {
  const fires = [
    "curl -s https://x.example",
    "wget x",
    "nc host 80",
    "Invoke-WebRequest x",
    "Invoke-RestMethod x",
    "open http://x.example",
    "fetch(url)",
    "requests.get(u)",
  ];
  for (const text of fires) {
    const q = assessQuality(hook({ SessionStart: [{ hooks: [cmd(text)] }] }));
    assert.deepEqual(risk(q, "network"), [0], text);
  }
  const http = assessQuality(
    hook({ SessionStart: [{ hooks: [{ type: "http", url: "https://x.example", timeout: 1 }] }] }),
  );
  assert.deepEqual(risk(http, "network"), [0]);
  const silent = ["echo 'curl https://x.example'", "# curl x", "echo sync", "echo hi"];
  for (const text of silent) {
    const q = assessQuality(hook({ SessionStart: [{ hooks: [cmd(text)] }] }));
    assert.equal(risk(q, "network"), null, text);
  }
  const prompt = assessQuality(
    hook({ Stop: [{ hooks: [{ type: "prompt", prompt: "Run curl https://x.example" }] }] }),
  );
  assert.equal(risk(prompt, "network"), null, "prompt text is not a command");
});

test("blocks_tools / blocks_prompts: only for block mode on the matching events", () => {
  const q = assessQuality(
    hook({
      PreToolUse: [{ matcher: "Bash", hooks: [cmd("exit 2"), cmd('echo \'{"decision":"ask"}\'')] }],
      PermissionRequest: [
        { matcher: "Bash", hooks: [cmd('echo \'{"permissionDecision":"deny"}\'')] },
      ],
      UserPromptSubmit: [{ hooks: [cmd("exit 2")] }],
      PostToolUse: [{ matcher: "Bash", hooks: [cmd("exit 2")] }],
      Stop: [{ hooks: [cmd("exit 2")] }],
    }),
  );
  assert.deepEqual(risk(q, "blocks_tools"), [0, 2]);
  assert.deepEqual(risk(q, "blocks_prompts"), [3]);
  assert.deepEqual(
    rows(q).map((r) => r.blocking),
    ["block", "ask", "block", "block", "block", "block"],
  );
  const ask = assessQuality(
    hook({
      PreToolUse: [{ matcher: "Bash", hooks: [cmd('echo \'{"decision":"ask"}\'')] }],
      UserPromptSubmit: [{ hooks: [cmd('echo \'{"decision":"ask"}\'')] }],
    }),
  );
  assert.equal(risk(ask, "blocks_tools"), null);
  assert.equal(risk(ask, "blocks_prompts"), null);
});

test("every_prompt: UserPromptSubmit, SessionStart, Pre/PostToolUse without matcher or with *", () => {
  const q = assessQuality(
    hook({
      UserPromptSubmit: [{ hooks: [cmd("echo a")] }],
      SessionStart: [{ hooks: [cmd("echo a")] }],
      PreToolUse: [
        { hooks: [cmd("echo a")] },
        { matcher: "*", hooks: [cmd("echo a")] },
        { matcher: "Bash", hooks: [cmd("echo a")] },
      ],
      PostToolUse: [{ matcher: "", hooks: [cmd("echo a")] }],
      PermissionRequest: [{ hooks: [cmd("echo a")] }],
      Stop: [{ hooks: [cmd("echo a")] }],
    }),
  );
  assert.deepEqual(risk(q, "every_prompt"), [0, 1, 2, 3, 5]);
  const none = assessQuality(
    hook({ PreToolUse: [{ matcher: "Bash|Write", hooks: [cmd("echo a")] }] }),
  );
  assert.equal(risk(none, "every_prompt"), null);
});

test("llm_hook: prompt and agent handlers only", () => {
  const q = assessQuality(
    hook({
      Stop: [
        {
          hooks: [
            cmd("echo a"),
            { type: "prompt", prompt: "p" },
            { type: "http", url: "https://x.example", timeout: 1 },
            { type: "agent", agent: "a" },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(risk(q, "llm_hook"), [1, 3]);
  const none = assessQuality(hook({ Stop: [{ hooks: [cmd("echo a")] }] }));
  assert.equal(risk(none, "llm_hook"), null);
});

test("risks: fixed label order, labels without rows are omitted", () => {
  const q = assessQuality(
    hook({
      Stop: [{ hooks: [{ type: "agent", agent: "a" }] }],
      UserPromptSubmit: [{ hooks: [cmd("exit 2")] }],
    }),
  );
  assert.deepEqual(
    q.hook!.risks.map((r) => r.label),
    ["blocks_prompts", "every_prompt", "llm_hook"],
  );
  const clean = assessQuality(hook({ Stop: [{ hooks: [cmd("echo a")] }] }));
  assert.deepEqual(clean.hook!.risks, []);
});

test("Q_HOOK_NO_TIMEOUT: command/http without timeout; prompt/agent are not counted", () => {
  const q = assessQuality(
    hook({
      Stop: [
        {
          hooks: [
            cmd("echo a", null),
            { type: "http", url: "https://x.example" },
            { type: "prompt", prompt: "p" },
            { type: "agent", agent: "a" },
          ],
        },
      ],
    }),
  );
  const check = q.checks.find((c) => c.code === "Q_HOOK_NO_TIMEOUT")!;
  assert.equal(check.severity, "warn");
  assert.deepEqual(check.hits, [
    { path: "hooks/hooks.json", excerpt: "hooks.Stop[0].hooks[0]" },
    { path: "hooks/hooks.json", excerpt: "hooks.Stop[0].hooks[1]" },
  ]);
  const ok = assessQuality(
    hook({
      Stop: [
        {
          hooks: [
            cmd("echo a"),
            { type: "http", url: "https://x.example", timeout: 3 },
            { type: "prompt", prompt: "p" },
            { type: "agent", agent: "a" },
          ],
        },
      ],
    }),
  );
  assert.ok(!has(ok, "Q_HOOK_NO_TIMEOUT"));
});

test("Q_HOOK_HARD_BLOCK: block mode fires (info), ask does not", () => {
  const q = assessQuality(
    hook({
      PreToolUse: [{ matcher: "Bash", hooks: [cmd("exit 2")] }],
      Stop: [{ hooks: [cmd('echo \'{"decision":"block"}\'')] }],
    }),
  );
  const check = q.checks.find((c) => c.code === "Q_HOOK_HARD_BLOCK")!;
  assert.equal(check.severity, "info");
  assert.deepEqual(
    check.hits.map((h) => h.excerpt),
    ["hooks.PreToolUse[0].hooks[0]", "hooks.Stop[0].hooks[0]"],
  );
  const ask = assessQuality(
    hook({ PreToolUse: [{ matcher: "Bash", hooks: [cmd('echo \'{"decision":"ask"}\'')] }] }),
  );
  assert.ok(!has(ask, "Q_HOOK_HARD_BLOCK"));
  assert.equal(ask.grade, "A");
});

test("Q_HOOK_BROAD_MATCHER: tool events without matcher or with *; other events and named matchers do not fire", () => {
  const q = assessQuality(
    hook({
      PreToolUse: [{ hooks: [cmd("echo a")] }],
      PostToolUse: [{ matcher: "*", hooks: [cmd("echo a")] }],
      PermissionRequest: [{ matcher: "", hooks: [cmd("echo a")] }],
      UserPromptSubmit: [{ hooks: [cmd("echo a")] }],
      SessionStart: [{ hooks: [cmd("echo a")] }],
    }),
  );
  const check = q.checks.find((c) => c.code === "Q_HOOK_BROAD_MATCHER")!;
  assert.equal(check.severity, "warn");
  assert.deepEqual(
    check.hits.map((h) => h.excerpt),
    [
      "hooks.PreToolUse[0].hooks[0]",
      "hooks.PostToolUse[0].hooks[0]",
      "hooks.PermissionRequest[0].hooks[0]",
    ],
  );
  const named = assessQuality(
    hook({
      PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo a")] }],
      PostToolUse: [{ matcher: "Write|Edit", hooks: [cmd("echo a")] }],
    }),
  );
  assert.ok(!has(named, "Q_HOOK_BROAD_MATCHER"));
});

test("Q_HOOK_INLINE_LONG: inline command over 200 chars without script; script reference does not fire", () => {
  const long = `echo ${"a".repeat(200)}`;
  const q = assessQuality(hook({ SessionStart: [{ hooks: [cmd(long)] }] }));
  const check = q.checks.find((c) => c.code === "Q_HOOK_INLINE_LONG")!;
  assert.equal(check.severity, "info");
  assert.deepEqual(check.hits, [
    { path: "hooks/hooks.json", excerpt: "hooks.SessionStart[0].hooks[0]" },
  ]);
  const exact = assessQuality(hook({ SessionStart: [{ hooks: [cmd("a".repeat(200))] }] }));
  assert.ok(!has(exact, "Q_HOOK_INLINE_LONG"), "200 chars is not long");
  const withScript = assessQuality(
    hook(
      { SessionStart: [{ hooks: [cmd(`${SCRIPT_CMD} ${"x".repeat(250)}`)] }] },
      {
        "scripts/run.sh": "exit 0\n",
      },
    ),
  );
  assert.ok(!has(withScript, "Q_HOOK_INLINE_LONG"));
  const prompt = assessQuality(
    hook({ Stop: [{ hooks: [{ type: "prompt", prompt: "p".repeat(300) }] }] }),
  );
  assert.ok(!has(prompt, "Q_HOOK_INLINE_LONG"));
});

test("score: all four hook codes give 60 / C; hook section only for hooks", () => {
  const q = assessQuality(
    hook({
      PreToolUse: [{ hooks: [cmd(`exit 2; ${"x".repeat(200)}`, null)] }],
    }),
  );
  assert.deepEqual(codes(q).sort(), [
    "Q_HOOK_BROAD_MATCHER",
    "Q_HOOK_HARD_BLOCK",
    "Q_HOOK_INLINE_LONG",
    "Q_HOOK_NO_TIMEOUT",
  ]);
  assert.equal(q.score, 60);
  assert.equal(q.grade, "C");
  const skill = parseArtifact({
    type: "skill",
    files: [
      {
        path: "demo/SKILL.md",
        content:
          "---\nname: demo\ndescription: Does things. Use when needed. Not for x.\n---\n\nBody\n",
      },
    ],
  });
  assert.ok(skill.ok);
  if (!skill.ok) return;
  const sq = assessQuality(skill.artifact);
  assert.ok(!("hook" in sq));
  assert.ok(!sq.checks.some((c) => c.code.startsWith("Q_HOOK_")));
});

test("deterministic: same artifact gives identical JSON", () => {
  const a = hook(
    {
      PreToolUse: [{ hooks: [cmd("curl https://x.example >> log", null)] }],
      UserPromptSubmit: [{ hooks: [cmd(SCRIPT_CMD)] }],
      Stop: [{ hooks: [{ type: "agent", agent: "a" }] }],
    },
    { "scripts/run.sh": 'echo \'{"decision":"block"}\'\n' },
  );
  assert.equal(JSON.stringify(assessQuality(a)), JSON.stringify(assessQuality(a)));
});

// ── quality heuristics: blocking, writes_files, network ──────────────────────

test("blocking: dynamic exit codes and jq-built decisions", () => {
  const exitVar = assessQuality(
    hook({ PreToolUse: [{ matcher: "Bash", hooks: [cmd("exit $CODE")] }] }),
  );
  assert.equal(rows(exitVar)[0]!.blocking, "unknown");
  const exitVarBrace = assessQuality(
    hook({ PreToolUse: [{ matcher: "Bash", hooks: [cmd("exit ${RESULT}")] }] }),
  );
  assert.equal(rows(exitVarBrace)[0]!.blocking, "unknown");
  const jqBlock = assessQuality(
    hook({
      PreToolUse: [{ matcher: "Bash", hooks: [cmd("jq -n --arg d block '{decision:$d}'")] }],
    }),
  );
  assert.equal(rows(jqBlock)[0]!.blocking, "block");
  const dynDecision = assessQuality(
    hook({ PreToolUse: [{ matcher: "Bash", hooks: [cmd('echo "{\\"decision\\":$outcome}"')] }] }),
  );
  assert.equal(rows(dynDecision)[0]!.blocking, "unknown");
});

test("writes_files: nested bundle scripts and more write commands", () => {
  for (const text of ["touch out", "mkdir -p d", "git commit -m x", "git push origin main"]) {
    const q = assessQuality(hook({ SessionStart: [{ hooks: [cmd(text)] }] }));
    assert.deepEqual(risk(q, "writes_files"), [0], text);
  }
  const nested = assessQuality(
    hook(
      { SessionStart: [{ hooks: [cmd(SCRIPT_CMD)] }] },
      {
        "scripts/run.sh": '"${CLAUDE_PLUGIN_ROOT}"/scripts/inner.sh\n',
        "scripts/inner.sh": "touch done\n",
      },
    ),
  );
  assert.deepEqual(risk(nested, "writes_files"), [0], "nested script writes files");
});

test("network: --nc flag is not netcat", () => {
  const flag = assessQuality(hook({ SessionStart: [{ hooks: [cmd("tool --nc fast")] }] }));
  assert.equal(risk(flag, "network"), null);
  const real = assessQuality(hook({ SessionStart: [{ hooks: [cmd("nc host 80")] }] }));
  assert.deepEqual(risk(real, "network"), [0]);
});
