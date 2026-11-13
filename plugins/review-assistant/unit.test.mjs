// Unit tests for the review-assistant plugin: they import the REAL plugin modules
// and pin down the pure logic — markdown escaping and the built-in judge reduction.
// Run: `node --test plugins/review-assistant/unit.test.mjs`.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { escapeMarkdown } from "./tab.js";
import { mergeBuiltin } from "./judge.js";
import { purgeReviewData, decisionNotification } from "./index.js";
import { verifiedFindings, runLlmReviewer, PROMPT_VERSION } from "./llm-reviewer.js";

// ── escapeMarkdown ────────────────────────────────────────────────────────────
test("escapeMarkdown neutralises image beacons", () => {
  const out = escapeMarkdown("![beacon](https://evil.example/x)");
  assert.equal(out.includes("!["), false);
  assert.equal(out.includes("]("), false);
  assert.equal(out.includes("\\!\\["), true);
});

test("escapeMarkdown neutralises links", () => {
  const out = escapeMarkdown("see [docs](https://example.com) here");
  assert.equal(out.includes("[docs]("), false);
  assert.equal(out.includes("\\[docs\\]\\("), true);
});

test("escapeMarkdown neutralises HTML and table metacharacters", () => {
  assert.equal(
    escapeMarkdown("<b>bold</b> | pipe > gt & amp"),
    "\\<b\\>bold\\</b\\> \\| pipe \\> gt \\& amp",
  );
});

test("escapeMarkdown neutralises emphasis and heading metacharacters", () => {
  assert.equal(
    escapeMarkdown("`code` *star* _underscore_ # heading"),
    "\\`code\\` \\*star\\* \\_underscore\\_ \\# heading",
  );
});

test("escapeMarkdown returns empty string for non-strings", () => {
  assert.equal(escapeMarkdown(null), "");
  assert.equal(escapeMarkdown(undefined), "");
  assert.equal(escapeMarkdown(42), "");
});

// ── mergeBuiltin ──────────────────────────────────────────────────────────────
const finding = (over = {}) => ({
  severity: "medium",
  category: "clarity",
  file: "SKILL.md",
  line: 10,
  summary: "summary",
  suggestion: "suggestion",
  ...over,
});

test("mergeBuiltin merges same category+file+line(±3) and reports agreement", () => {
  const out = mergeBuiltin([
    { id: "strict", status: "ok", findings: [finding()] },
    { id: "lenient", status: "ok", findings: [finding({ line: 12 })] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].agreed, 2);
  assert.equal(out[0].of, 2);
  assert.deepEqual([...out[0].reviewers].sort(), ["lenient", "strict"]);
});

test("mergeBuiltin keeps different files as separate groups", () => {
  const out = mergeBuiltin([
    { id: "a", status: "ok", findings: [finding({ file: "A.md" })] },
    { id: "b", status: "ok", findings: [finding({ file: "B.md" })] },
  ]);
  assert.equal(out.length, 2);
});

test("mergeBuiltin keeps findings more than 3 lines apart separate", () => {
  const out = mergeBuiltin([
    { id: "a", status: "ok", findings: [finding({ line: 10 })] },
    { id: "b", status: "ok", findings: [finding({ line: 14 })] },
  ]);
  assert.equal(out.length, 2);
});

test("mergeBuiltin sorts by severity then agreement", () => {
  const out = mergeBuiltin([
    { id: "a", status: "ok", findings: [finding({ severity: "low" })] },
    { id: "b", status: "ok", findings: [finding({ severity: "high", file: "B.md" })] },
    { id: "c", status: "ok", findings: [finding({ severity: "high", file: "C.md" })] },
  ]);
  assert.deepEqual(
    out.map((g) => g.severity),
    ["high", "high", "low"],
  );
});

test("mergeBuiltin ignores non-ok reviewers and their findings", () => {
  const out = mergeBuiltin([
    { id: "a", status: "ok", findings: [finding()] },
    { id: "b", status: "failed", findings: [finding({ file: "B.md" })] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].of, 1);
});

// ── decisionNotification ────────────────────────────────────────
const run = { artifact_type: "skill", artifact_name: "pdf tools", version: "0.1.0" };

test("decisionNotification notifies the version author", () => {
  const n = decisionNotification({
    run,
    author: "alice",
    actor: "reviewer",
    decision: "fix",
    note: "please fix",
  });
  assert.deepEqual(n.users, ["alice"]);
  assert.equal(n.title, "Review decision: fix");
  assert.equal(n.text, "please fix");
  assert.equal(n.url, "/artifacts/skill/pdf%20tools?version=0.1.0#review");
  assert.deepEqual(n.artifact, { type: "skill", name: "pdf tools" });
  assert.equal(n.version, "0.1.0");
});

test("decisionNotification returns null for self-decision and missing author", () => {
  assert.equal(
    decisionNotification({ run, author: "alice", actor: "alice", decision: "reject" }),
    null,
  );
  assert.equal(
    decisionNotification({ run, author: undefined, actor: "reviewer", decision: "fix" }),
    null,
  );
  assert.equal(
    decisionNotification({ run, author: null, actor: "reviewer", decision: "defer" }),
    null,
  );
});

test("decisionNotification omits text when note is null", () => {
  const n = decisionNotification({
    run,
    author: "alice",
    actor: "bob",
    decision: "verify",
    note: null,
  });
  assert.equal(n.text, undefined);
});

test("artifact.purged removes only matching review runs and their findings", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE ext_review_assistant_runs (id INTEGER PRIMARY KEY, artifact_type TEXT, artifact_name TEXT, version TEXT);
      CREATE TABLE ext_review_assistant_findings (id INTEGER PRIMARY KEY, run_id INTEGER, summary TEXT);`);
    const run = db.prepare("INSERT INTO ext_review_assistant_runs VALUES (?, 'skill', ?, ?)");
    run.run(1, "leaky", "0.1.0");
    run.run(2, "leaky", "0.2.0");
    run.run(3, "other", "0.1.0");
    const finding = db.prepare("INSERT INTO ext_review_assistant_findings VALUES (?, ?, ?)");
    finding.run(1, 1, "secret");
    finding.run(2, 2, "safe");
    finding.run(3, 3, "other");
    purgeReviewData(db, { artifact: { type: "skill", name: "leaky" }, version: "0.1.0" });
    assert.deepEqual(
      db
        .prepare("SELECT id FROM ext_review_assistant_runs ORDER BY id")
        .all()
        .map((r) => r.id),
      [2, 3],
    );
    assert.deepEqual(
      db
        .prepare("SELECT id FROM ext_review_assistant_findings ORDER BY id")
        .all()
        .map((r) => r.id),
      [2, 3],
    );
    purgeReviewData(db, { artifact: { type: "skill", name: "leaky" }, version: null });
    assert.deepEqual(
      db
        .prepare("SELECT id FROM ext_review_assistant_runs")
        .all()
        .map((r) => r.id),
      [3],
    );
    assert.deepEqual(
      db
        .prepare("SELECT id FROM ext_review_assistant_findings")
        .all()
        .map((r) => r.id),
      [3],
    );
  } finally {
    db.close();
  }
});

// ── strict model output (llm-budget-broker) ──────────────────────────────────

const FILES = [
  {
    path: "skills/demo/SKILL.md",
    content: "line one\nAlways use the latest version of the tool.\nline three\n",
  },
];
const strictFinding = (over = {}) => ({
  severity: "high",
  category: "unsafe_command",
  file: "skills/demo/SKILL.md",
  quote: "Always use the latest version",
  summary: "Unpinned tool version",
  suggestion: "Pin the version",
  ...over,
});
const answer = (findings) => JSON.stringify({ findings });

test("strict output: a valid answer gives findings with lines computed from the quote", () => {
  const r = verifiedFindings(answer([strictFinding()]), FILES, 20);
  assert.equal(r.error, undefined);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].line, 2);
  assert.deepEqual(verifiedFindings('```json\n{"findings":[]}\n```', FILES, 20), { findings: [] });
  assert.equal(PROMPT_VERSION, "2");
});

test("strict output: any invalid finding fails the whole answer", () => {
  const cases = [
    ["not json", "unparseable"],
    [JSON.stringify({ findings: [], extra: 1 }), "extra top-level key"],
    [
      answer([strictFinding(), strictFinding({ quote: "this text is not in the file" })]),
      "invented quote",
    ],
    [answer([strictFinding({ file: "skills/other/SKILL.md" })]), "unknown file"],
    [answer([{ ...strictFinding(), confidence: 0.9 }]), "extra finding key"],
    [answer([strictFinding({ severity: "critical" })]), "unknown severity"],
    [answer([strictFinding({ category: "style" })]), "unknown category"],
    [answer([strictFinding(), strictFinding(), strictFinding()]), "more than max findings"],
    [
      '{"findings":[{"severity":"high","category":"unsafe_command","file":"skills/demo/SKILL.md","quote":"Always use the latest version","quote":"Always use the latest version","summary":"s","suggestion":"t"}]}',
      "duplicate key",
    ],
  ];
  for (const [text, label] of cases) {
    const r = verifiedFindings(text, FILES, 2);
    assert.ok(r.error, `${label}: accepted`);
    assert.equal(r.findings, undefined, `${label}: partial findings`);
  }
});

test("background reviewer passes its task grant only to the model transport", async () => {
  const secret = `as_sf_${"x".repeat(43)}`;
  let call;
  const result = await runLlmReviewer(
    {
      complete: async (args) => {
        call = args;
        return { text: '{"findings":[]}', model: "deepseek-chat" };
      },
    },
    { type: "skill", name: "demo", description: "demo" },
    { version: "1.0.0" },
    FILES,
    20,
    secret,
  );
  assert.equal(result.status, "ok");
  assert.equal(call.budgetGrant, secret);
  assert.equal(JSON.stringify(call.messages).includes(secret), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});
