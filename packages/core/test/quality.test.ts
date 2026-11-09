import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArtifact } from "../src/artifact/index.ts";
import type { ArtifactType, ParsedArtifact } from "../src/artifact/types.ts";
import { assessQuality, QUALITY_CODES } from "../src/quality/index.ts";
import type { QualityCode, QualityReport } from "../src/quality/index.ts";

const GOOD_DESC =
  "Extracts line items from PDF invoices into CSV files. Use when the user asks to pull invoice tables out of PDF documents. Do not use for scanned images.";

type Files = Array<{ path: string; content: string }>;

function parse(type: ArtifactType, files: Files): ParsedArtifact {
  const r = parseArtifact({ type, files });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.artifact;
}

function skill(
  opts: { description?: string; fm?: string; body?: string; extra?: Files } = {},
): ParsedArtifact {
  const desc = opts.description ?? GOOD_DESC;
  const body = opts.body ?? "# Demo\n\nDo the thing.\n\n## Example\n\n```bash\nrun it\n```\n";
  const fm = opts.fm ? `${opts.fm}\n` : "";
  return parse("skill", [
    {
      path: "demo/SKILL.md",
      content: `---\nname: demo\ndescription: ${desc}\n${fm}---\n\n${body}`,
    },
    ...(opts.extra ?? []).map((f) => ({ path: `demo/${f.path}`, content: f.content })),
  ]);
}

function command(fm = "", body = "Run it.\n\n```bash\nls\n```\n"): ParsedArtifact {
  return parse("command", [
    {
      path: "demo.md",
      content: `---\nname: demo\ndescription: ${GOOD_DESC}\n${fm}${fm ? "\n" : ""}---\n\n${body}`,
    },
  ]);
}

function agent(fm = "", body = "Be helpful.\n"): ParsedArtifact {
  return parse("agent", [
    {
      path: "demo.md",
      content: `---\nname: demo\ndescription: ${GOOD_DESC}\nmodel: sonnet\n${fm}${fm ? "\n" : ""}---\n\n${body}`,
    },
  ]);
}

function hook(readme: string): ParsedArtifact {
  return parse("hook", [
    {
      path: "demo/hooks.json",
      content: JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo hi", timeout: 5 }] }],
        },
      }),
    },
    { path: "demo/README.md", content: readme },
  ]);
}

const codes = (q: QualityReport): QualityCode[] => q.checks.map((c) => c.code);
const has = (q: QualityReport, code: QualityCode) => codes(q).includes(code);
const hit = (q: QualityReport, code: QualityCode) => q.checks.find((c) => c.code === code)!.hits;

test("QUALITY_CODES has exactly the eighteen codes", () => {
  assert.deepEqual(Object.keys(QUALITY_CODES).sort(), [
    "Q_BODY_LONG",
    "Q_DESC_NO_BOUNDARY",
    "Q_DESC_NO_TRIGGER",
    "Q_DESC_PERSON",
    "Q_DESC_SHORT",
    "Q_HOOK_BROAD_MATCHER",
    "Q_HOOK_HARD_BLOCK",
    "Q_HOOK_INLINE_LONG",
    "Q_HOOK_NO_TIMEOUT",
    "Q_NO_EXAMPLE",
    "Q_REF_DEEP",
    "Q_SETTINGS_API_KEY_HELPER",
    "Q_SETTINGS_BROAD_ALLOW",
    "Q_SETTINGS_BYPASS",
    "Q_SETTINGS_HOOKS",
    "Q_TIME_SENSITIVE",
    "Q_TOOLS_UNBOUNDED",
    "Q_WINDOWS_PATH",
  ]);
});

test("strong skill: grade A, no checks, metrics", () => {
  const q = assessQuality(skill());
  assert.equal(q.algorithm, 5);
  assert.ok(!("hook" in q));
  assert.deepEqual(q.checks, []);
  assert.equal(q.score, 100);
  assert.equal(q.grade, "A");
  assert.equal(q.metrics.markdown_files, 1);
  assert.equal(q.metrics.code_blocks, 1);
  assert.equal(q.metrics.reference_depth, 0);
  assert.equal(q.metrics.description_words, GOOD_DESC.split(" ").length);
  assert.equal(q.metrics.description_chars, GOOD_DESC.length);
  assert.equal(q.metrics.body_tokens_est, Math.ceil(q.metrics.body_chars / 4));
});

test("Q_DESC_SHORT: fewer than 10 words fires, 10 words does not", () => {
  const short = assessQuality(skill({ description: "Helps with PDFs. Use when asked." }));
  assert.ok(has(short, "Q_DESC_SHORT"));
  assert.equal(short.checks.find((c) => c.code === "Q_DESC_SHORT")!.severity, "warn");
  assert.deepEqual(hit(short, "Q_DESC_SHORT"), [
    { path: "skills/demo/SKILL.md", line: 3, excerpt: "Helps with PDFs. Use when asked." },
  ]);
  const ten = assessQuality(
    skill({ description: "One two three four five six seven eight nine ten" }),
  );
  assert.ok(!has(ten, "Q_DESC_SHORT"));
});

test("Q_DESC_NO_TRIGGER: trigger phrases are recognised case-insensitively", () => {
  const none = assessQuality(
    skill({ description: "Extracts tables from PDF invoices into tidy CSV files quickly." }),
  );
  assert.ok(has(none, "Q_DESC_NO_TRIGGER"));
  for (const phrase of [
    "Use when",
    "USE FOR",
    "when the user",
    "Invoke when",
    "triggers on",
    "use this skill when",
  ]) {
    const q = assessQuality(
      skill({ description: `Extracts tables from PDF invoices. ${phrase} something happens.` }),
    );
    assert.ok(!has(q, "Q_DESC_NO_TRIGGER"), phrase);
  }
});

test("Q_DESC_NO_BOUNDARY: boundary phrases", () => {
  const none = assessQuality(
    skill({ description: "Extracts tables from PDF invoices. Use when asked for tables." }),
  );
  assert.ok(has(none, "Q_DESC_NO_BOUNDARY"));
  assert.equal(none.checks.find((c) => c.code === "Q_DESC_NO_BOUNDARY")!.severity, "info");
  for (const phrase of ["Do not use for", "Don't use", "not intended for", "skip when", "unless"]) {
    const q = assessQuality(
      skill({ description: `Extracts tables from PDF invoices. Use when asked. ${phrase} X.` }),
    );
    assert.ok(!has(q, "Q_DESC_NO_BOUNDARY"), phrase);
  }
});

test("Q_DESC_PERSON: first person start or phrase", () => {
  assert.ok(has(assessQuality(skill({ description: `I ${GOOD_DESC}` })), "Q_DESC_PERSON"));
  assert.ok(has(assessQuality(skill({ description: `We ${GOOD_DESC}` })), "Q_DESC_PERSON"));
  assert.ok(
    has(assessQuality(skill({ description: `${GOOD_DESC} I'll do it.` })), "Q_DESC_PERSON"),
  );
  assert.ok(
    has(
      assessQuality(skill({ description: `${GOOD_DESC} You can use this daily.` })),
      "Q_DESC_PERSON",
    ),
  );
  assert.ok(
    !has(assessQuality(skill({ description: `${GOOD_DESC} Invoices in PDF.` })), "Q_DESC_PERSON"),
  );
});

test("Q_BODY_LONG: body above 5000 tokens", () => {
  const long = assessQuality(skill({ body: "word ".repeat(4100) }));
  assert.ok(has(long, "Q_BODY_LONG"));
  assert.ok(long.metrics.body_tokens_est > 5000);
  const ok = assessQuality(skill({ body: "word ".repeat(3900) }));
  assert.ok(!has(ok, "Q_BODY_LONG"));
  assert.ok(ok.metrics.body_tokens_est <= 5000);
});

test("Q_REF_DEEP: second-level references resolve relative to the referencing file", () => {
  const deep = assessQuality(
    skill({
      body: "See [A](references/A.md).\n\n```bash\nx\n```\n",
      extra: [
        { path: "references/A.md", content: "Go to [B](B.md)." },
        { path: "references/B.md", content: "End." },
      ],
    }),
  );
  assert.ok(has(deep, "Q_REF_DEEP"));
  assert.deepEqual(hit(deep, "Q_REF_DEEP"), [{ path: "skills/demo/references/A.md" }]);
  assert.equal(deep.metrics.reference_depth, 2);

  const shallow = assessQuality(
    skill({
      body: "See references/A.md for details.\n\n```bash\nx\n```\n",
      extra: [
        {
          path: "references/A.md",
          content: "Nothing links [out](https://example.com) or to missing.md.",
        },
      ],
    }),
  );
  assert.ok(!has(shallow, "Q_REF_DEEP"));
  assert.equal(shallow.metrics.reference_depth, 1);

  const selfOnly = assessQuality(
    skill({
      body: "See [A](references/A.md).\n\n```bash\nx\n```\n",
      extra: [
        { path: "references/A.md", content: "See [self](A.md) and [script](../scripts/run.sh)." },
      ],
    }),
  );
  assert.ok(!has(selfOnly, "Q_REF_DEEP"), "self-links and non-markdown targets do not count");
  assert.equal(selfOnly.metrics.reference_depth, 1);

  const cyclic = assessQuality(
    skill({
      body: "See [A](references/A.md).\n\n```bash\nx\n```\n",
      extra: [{ path: "references/A.md", content: "Back to [SKILL](../SKILL.md)." }],
    }),
  );
  assert.ok(has(cyclic, "Q_REF_DEEP"), "any other .md of the bundle counts, per spec");
  assert.equal(cyclic.metrics.reference_depth, 1, "cycles do not inflate depth");
});

test("Q_TIME_SENSITIVE: patterns with file and line", () => {
  const body =
    "Intro.\n\nAs of March 2025 it works.\nUse the latest version.\nSince 2023 it is stable.\nThis year we ship.\nRecently deprecated flags.\n\n```bash\nx\n```\n";
  const q = assessQuality(skill({ body }));
  assert.ok(has(q, "Q_TIME_SENSITIVE"));
  const lines = hit(q, "Q_TIME_SENSITIVE").map((h) => h.line);
  assert.deepEqual(lines, [8, 9, 10, 11, 12]);
  assert.ok(
    hit(q, "Q_TIME_SENSITIVE").every((h) => h.path === "skills/demo/SKILL.md" && h.excerpt),
  );
  const ok = assessQuality(
    skill({ body: "The parser handles most files and versions.\n\n```bash\nx\n```\n" }),
  );
  assert.ok(!has(ok, "Q_TIME_SENSITIVE"));
});

test("Q_WINDOWS_PATH: fenced blocks and their language", () => {
  const body = [
    "Run scripts\\extract.py now.",
    "",
    "```powershell",
    "C:\\Tools\\x.exe",
    "```",
    "",
    "~~~cmd",
    "C:\\Tools\\y.exe",
    "~~~",
    "",
    "```bash",
    "C:\\Tools\\z.exe",
    "```",
    "",
    "```",
    "D:\\data\\in.csv",
    "```",
  ].join("\n");
  const q = assessQuality(skill({ body }));
  assert.ok(has(q, "Q_WINDOWS_PATH"));
  assert.deepEqual(
    hit(q, "Q_WINDOWS_PATH").map((h) => h.line),
    [6, 17, 21],
  );
  const ok = assessQuality(
    skill({ body: "Use scripts/extract.py.\n\n```powershell\nC:\\Tools\\x.exe\n```\n" }),
  );
  assert.ok(!has(ok, "Q_WINDOWS_PATH"));
});

test("Q_TOOLS_UNBOUNDED: allowed-tools string/list and Bash variants", () => {
  for (const fm of [
    'allowed-tools: "*"',
    "allowed-tools: Read, Bash",
    "allowed-tools: Bash(*)",
    "allowed-tools: Bash( : * )",
    "allowed-tools:\n  - Read\n  - Bash(:*)",
  ]) {
    const q = assessQuality(skill({ fm }));
    assert.ok(has(q, "Q_TOOLS_UNBOUNDED"), fm);
    assert.equal(hit(q, "Q_TOOLS_UNBOUNDED")[0]!.line, 4, fm);
  }
  for (const fm of ["allowed-tools: Read, Bash(pdftotext:*)", "allowed-tools: Read, Grep", ""]) {
    assert.ok(!has(assessQuality(skill({ fm })), "Q_TOOLS_UNBOUNDED"), fm);
  }
});

test("Q_NO_EXAMPLE: code block or example heading", () => {
  assert.ok(has(assessQuality(skill({ body: "Just prose.\n" })), "Q_NO_EXAMPLE"));
  assert.ok(!has(assessQuality(skill({ body: "Prose.\n\n```\nx\n```\n" })), "Q_NO_EXAMPLE"));
  assert.ok(
    !has(assessQuality(skill({ body: "Prose.\n\n## Examples\n\nDo it.\n" })), "Q_NO_EXAMPLE"),
  );
  assert.ok(
    !has(
      assessQuality(
        skill({
          body: "Prose.\n",
          extra: [{ path: "references/R.md", content: "### Example\nx" }],
        }),
      ),
      "Q_NO_EXAMPLE",
    ),
  );
});

test("grade boundaries", () => {
  const weak = assessQuality(
    skill({
      description: "Helps with PDFs.",
      fm: 'allowed-tools: "*"',
      body: "As of March 2025.\nRun scripts\\x.py.\nSee [A](references/A.md).",
      extra: [
        { path: "references/A.md", content: "[B](B.md)" },
        { path: "references/B.md", content: "end" },
      ],
    }),
  );
  assert.equal(weak.score, 10);
  assert.equal(weak.grade, "D");

  // 2 info → 90 → A
  const a = assessQuality(
    skill({
      description:
        "Extracts tables from PDF invoices into CSV files. Use when asked for tables now.",
      body: "Prose only.\n",
    }),
  );
  assert.deepEqual(codes(a).sort(), ["Q_DESC_NO_BOUNDARY", "Q_NO_EXAMPLE"]);
  assert.equal(a.score, 90);
  assert.equal(a.grade, "A");
  // 1 warn + 2 info → 75 → B
  const b = assessQuality(
    skill({
      description:
        "Extracts tables from PDF invoices into CSV files. Use when asked for tables now.",
      body: "Prose C:\\x\\y.txt only.\n",
    }),
  );
  assert.equal(b.score, 75);
  assert.equal(b.grade, "B");
  // 2 warn + 2 info → 60 → C
  const c = assessQuality(
    skill({
      description:
        "Extracts tables from PDF invoices into CSV files. Use when asked for tables now.",
      fm: "allowed-tools: Bash",
      body: "Prose C:\\x\\y.txt only.\n",
    }),
  );
  assert.equal(c.score, 60);
  assert.equal(c.grade, "C");
  // 3 warn + 2 info → 45 → D
  const d = assessQuality(
    skill({
      description: "Extracts tables from PDF invoices into CSV files quickly and neatly today.",
      fm: "allowed-tools: Bash",
      body: "Prose C:\\x\\y.txt only.\n",
    }),
  );
  assert.equal(d.score, 45);
  assert.equal(d.grade, "D");
});

test("applicability: command has no Q_REF_DEEP", () => {
  const q = assessQuality(
    command("allowed-tools: Read, Bash", "See [A](references/A.md).\nC:\\tmp\\out.txt\n"),
  );
  assert.ok(has(q, "Q_TOOLS_UNBOUNDED"));
  assert.ok(has(q, "Q_WINDOWS_PATH"));
  assert.ok(has(q, "Q_NO_EXAMPLE"));
  assert.ok(!has(q, "Q_REF_DEEP"));
  assert.equal(hit(q, "Q_WINDOWS_PATH")[0]!.path, "commands/demo.md");
});

test("applicability: agent uses `tools`, no Q_REF_DEEP / Q_NO_EXAMPLE", () => {
  const q = assessQuality(agent("tools: Read, Bash", "Prose only, no examples.\nAs of 2024.\n"));
  assert.ok(has(q, "Q_TOOLS_UNBOUNDED"));
  assert.ok(has(q, "Q_TIME_SENSITIVE"));
  assert.ok(!has(q, "Q_NO_EXAMPLE"));
  assert.ok(!has(q, "Q_REF_DEEP"));
  const bounded = assessQuality(agent("tools: Read, Bash(git:*)", "Prose.\n"));
  assert.ok(!has(bounded, "Q_TOOLS_UNBOUNDED"));
  const skillTools = assessQuality(agent("allowed-tools: Bash", "Prose.\n"));
  assert.ok(!has(skillTools, "Q_TOOLS_UNBOUNDED"), "agent reads `tools`, not `allowed-tools`");
});

test("applicability: hook only Q_TIME_SENSITIVE, Q_WINDOWS_PATH and Q_HOOK_*", () => {
  const q = assessQuality(hook("# Hook\n\nShort.\n\nAs of 2025 run C:\\x\\run.bat.\n"));
  assert.deepEqual(codes(q).sort(), ["Q_TIME_SENSITIVE", "Q_WINDOWS_PATH"]);
  assert.equal(q.score, 80);
  const clean = assessQuality(hook("# Hook\n\nShort.\n"));
  assert.deepEqual(clean.checks, []);
  assert.equal(clean.grade, "A");
});

test("deterministic and never throws on degenerate artifacts", () => {
  const a = skill({ description: "Helps.", body: "As of 2020 use C:\\a\\b.txt" });
  assert.equal(JSON.stringify(assessQuality(a)), JSON.stringify(assessQuality(a)));
  const empty: ParsedArtifact = {
    type: "skill",
    name: "x",
    description: "",
    displayName: null,
    tags: [],
    frontmatter: null,
    files: [],
    canonical: [],
    digest: "",
  };
  const q = assessQuality(empty);
  assert.equal(q.algorithm, 5);
  assert.ok(has(q, "Q_DESC_SHORT"));
  assert.equal(q.metrics.markdown_files, 0);
  const binary: ParsedArtifact = {
    ...empty,
    canonical: [{ path: "skills/x/SKILL.md", content: new Uint8Array([0xff, 0xfe, 0x00, 0x80]) }],
  };
  assert.equal(assessQuality(binary).algorithm, 5);
  const hookNoJson: ParsedArtifact = { ...empty, type: "hook" };
  assert.deepEqual(assessQuality(hookNoJson).hook, { rows: [], risks: [] });
  const hookBadJson: ParsedArtifact = {
    ...empty,
    type: "hook",
    canonical: [{ path: "hooks/hooks.json", content: new TextEncoder().encode("{ nope") }],
  };
  assert.deepEqual(assessQuality(hookBadJson).hook, { rows: [], risks: [] });
});

// ── quality heuristics ─────────────────────────────────────────────

test("phrase boundaries: substrings do not count", () => {
  const reuse = assessQuality(
    skill({
      description:
        "Reuse for invoice extraction pipelines and daily reports. Not intended for scanned images.",
    }),
  );
  assert.ok(has(reuse, "Q_DESC_NO_TRIGGER"), "'reuse for' is not the 'use for' trigger");
  assert.ok(!has(reuse, "Q_DESC_NO_BOUNDARY"), "'not intended for' still matches at a boundary");
  const cant = assessQuality(
    skill({
      description:
        "Extracts invoice tables and we can't promise timing on bad scans. Do not use for images.",
    }),
  );
  assert.ok(!has(cant, "Q_DESC_PERSON"), `"we can't" is not the "we can" phrase`);
});

test("tokensEst: Cyrillic and CJK weigh more than chars/4", () => {
  const letters = String.fromCodePoint(...Array.from({ length: 24 }, (_, i) => 0x0410 + i));
  const cyr = assessQuality(skill({ body: `${letters} `.repeat(100) }));
  assert.ok(
    cyr.metrics.body_tokens_est > Math.ceil(cyr.metrics.body_chars / 4),
    "cyrillic text must not be estimated as ascii/4",
  );
  const cjk = assessQuality(skill({ body: "漢字のテキストです。".repeat(200) }));
  assert.ok(
    cjk.metrics.body_tokens_est >= cjk.metrics.body_chars / 2,
    "cjk text is about one token per character",
  );
});

test("Q_TIME_SENSITIVE: code fence contents do not count", () => {
  const fenced = assessQuality(
    skill({ body: "Intro.\n\n```bash\necho use the latest version\n```\n" }),
  );
  assert.ok(!has(fenced, "Q_TIME_SENSITIVE"));
  const plain = assessQuality(
    skill({ body: "Intro.\n\nUse the latest version.\n\n```bash\nx\n```\n" }),
  );
  assert.ok(has(plain, "Q_TIME_SENSITIVE"));
});

test("Q_WINDOWS_PATH: UNC paths and %VAR% paths without extensions", () => {
  const unc = assessQuality(skill({ body: "Mount \\\\fileserver\\tools for use.\n" }));
  assert.ok(has(unc, "Q_WINDOWS_PATH"), "UNC share without extension");
  const env = assessQuality(skill({ body: "See %USERPROFILE%\\tools here.\n" }));
  assert.ok(has(env, "Q_WINDOWS_PATH"), "%VAR% path without extension");
});

test("Q_TOOLS_UNBOUNDED: dangerous command wildcards", () => {
  for (const fm of [
    "allowed-tools: Bash(*:*)",
    "allowed-tools: Bash(rm:*)",
    "allowed-tools: Bash(sudo:*)",
  ]) {
    assert.ok(has(assessQuality(skill({ fm })), "Q_TOOLS_UNBOUNDED"), fm);
  }
  assert.ok(
    !has(assessQuality(skill({ fm: "allowed-tools: Bash(git status:*)" })), "Q_TOOLS_UNBOUNDED"),
  );
});

test("Q_NO_EXAMPLE: non/anti/counter-example headings do not count", () => {
  for (const h of ["## Non-examples", "## Anti-examples", "## Counter examples"]) {
    const q = assessQuality(skill({ body: `Prose.\n\n${h}\n\nNothing here.\n` }));
    assert.ok(has(q, "Q_NO_EXAMPLE"), h);
  }
});
