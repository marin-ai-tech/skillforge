// Hook analysis in the quality report: the "event → condition → action" table, blocking mode, risk labels,
// `Q_HOOK_*` codes, `algorithm` 2. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { startServer, api, login, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const RISKY_DIR = join(ROOT, "tests", "fixtures", "hooks", "risky");
const guardedFiles = () => toB64(loadDir(join(FIXTURES, "hook-guard")));
const riskyFiles = () => toB64(loadDir(RISKY_DIR));
const HOOK_CODES = ["Q_HOOK_BROAD_MATCHER", "Q_HOOK_HARD_BLOCK", "Q_HOOK_INLINE_LONG", "Q_HOOK_NO_TIMEOUT"];
const WARN = new Set(["Q_HOOK_NO_TIMEOUT", "Q_HOOK_BROAD_MATCHER"]);

let srv;
let base;
let admin;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-hooks-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

async function validate(body) {
  const r = await api(base, "POST", "/api/v1/artifacts/validate", body, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.errors, [], JSON.stringify(r.data.errors));
  assert.ok(r.data.quality, "no quality report");
  assert.equal(r.data.quality.algorithm, 5);
  return r.data.quality;
}

const pick = (row) => ({ event: row.event, matcher: row.matcher, type: row.type, timeout: row.timeout, blocking: row.blocking });
const codesOf = (q) => q.checks.map((c) => c.code).filter((c) => c.startsWith("Q_HOOK_")).sort();

test("hook with confirmation: a two-row table, mode ask, only the llm_hook label, grade A", async () => {
  const q = await validate({ type: "hook", name: "destructive-guard", files: guardedFiles() });
  assert.ok(q.hook, "the hook has a hook section");
  const rows = q.hook.rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(pick(rows[0]), { event: "PreToolUse", matcher: "Bash", type: "command", timeout: 10, blocking: "ask" });
  assert.equal(rows[0].script, "scripts/guard.sh");
  assert.deepEqual(rows[0].runtimes, ["claude-code"]);
  assert.match(rows[0].action, /guard\.sh/);
  assert.deepEqual(pick(rows[1]), { event: "Stop", matcher: null, type: "prompt", timeout: null, blocking: "unknown" });
  assert.equal(rows[1].script, null);
  assert.deepEqual(q.hook.risks, [{ label: "llm_hook", rows: [1] }], "the \"rm -rf /\" pattern in quotes and a comment do not yield writes_files");
  assert.deepEqual(codesOf(q), []);
  assert.equal(q.grade, "A");
});

test("risky hook: rows, blocking modes, risk labels, Q_HOOK_* codes, score 60 / C", async () => {
  const q = await validate({ type: "hook", files: riskyFiles() });
  const rows = q.hook.rows;
  assert.deepEqual(rows.map(pick), [
    { event: "PreToolUse", matcher: null, type: "command", timeout: null, blocking: "block" },
    { event: "UserPromptSubmit", matcher: null, type: "command", timeout: 5, blocking: "block" },
    { event: "PostToolUse", matcher: "Write|Edit", type: "http", timeout: 3, blocking: "unknown" },
    { event: "Stop", matcher: null, type: "agent", timeout: null, blocking: "unknown" },
  ]);
  assert.equal(rows[0].script, null, "inline command without a script");
  assert.ok(rows[0].action.length <= 200 && rows[0].action.endsWith("…"), `action is truncated: ${rows[0].action}`);
  assert.ok(typeof rows[1].script === "string" && rows[1].script.endsWith("scripts/block-secrets.sh"), `script: ${rows[1].script}`);
  assert.equal(rows[2].action, "https://audit.example.com/hook");
  assert.equal(rows[3].action, "reviewer");
  for (const r of rows) assert.deepEqual(r.runtimes, ["claude-code"]);

  assert.deepEqual(q.hook.risks, [
    { label: "blocks_tools", rows: [0] },
    { label: "blocks_prompts", rows: [1] },
    { label: "writes_files", rows: [1] },
    { label: "network", rows: [0, 2] },
    { label: "every_prompt", rows: [0, 1] },
    { label: "llm_hook", rows: [3] },
  ]);

  assert.deepEqual(codesOf(q), HOOK_CODES);
  for (const c of q.checks.filter((x) => x.code.startsWith("Q_HOOK_"))) {
    assert.equal(c.severity, WARN.has(c.code) ? "warn" : "info", c.code);
    assert.ok(c.hits.every((h) => h.path === "hooks/hooks.json"), JSON.stringify(c.hits));
  }
  const noTimeout = q.checks.find((c) => c.code === "Q_HOOK_NO_TIMEOUT");
  assert.deepEqual(noTimeout.hits.map((h) => h.excerpt), ["hooks.PreToolUse[0].hooks[0]"], "an agent hook without a timeout does not count");
  assert.equal(q.score, 60);
  assert.equal(q.grade, "C");
});

test("publishing a risky hook is not blocked; the card returns the same analysis", async () => {
  const v = await validate({ type: "hook", files: riskyFiles() });
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "hook", files: riskyFiles() }, { cookie: admin.cookie });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  assert.deepEqual(pub.data.quality.hook, v.hook);
  const card = await api(base, "GET", "/api/v1/artifacts/hook/risky-guard");
  assert.equal(card.status, 200);
  assert.deepEqual(card.data.latest.quality.hook, v.hook);
  assert.ok(card.data.latest.files.some((f) => f.path === v.hook.rows[1].script), "script is the canonical path of the version file");
  const { security, context, ...grade } = card.data.artifact.quality;
  assert.deepEqual(grade, { score: 60, grade: "C" });
  // content-security-scan: the summary also carries the scan verdict, the same as the version's report.
  assert.equal(security, card.data.latest.quality.security.verdict);
  // context-cost: and the level of the context cost, the same as the version's report.
  assert.equal(context, card.data.latest.quality.context.level);
});

test("non-hooks have no hook section, algorithm 2", async () => {
  const r = await api(
    base,
    "POST",
    "/api/v1/artifacts/validate",
    { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) },
    { cookie: admin.cookie },
  );
  assert.equal(r.status, 200);
  assert.equal(r.data.quality.algorithm, 5);
  assert.ok(!("hook" in r.data.quality), "the hook section exists only for hooks");
});

test("backfill on start: an algorithm 1 report is recomputed to algorithm 2 with a hook section", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "skillforge-hooks-backfill-"));
  let s1;
  let s2;
  try {
    s1 = await startServer({ SKILLFORGE_DATA_DIR: dataDir }, { prefix: "skillforge-hooks-s1-" });
    assert.ok(s1.up, s1.stderr);
    const a1 = await login(s1.base, "admin", ADMIN_PASSWORD);
    const pub = await api(s1.base, "POST", "/api/v1/artifacts", { type: "hook", name: "destructive-guard", files: guardedFiles() }, { cookie: a1.cookie });
    assert.equal(pub.status, 201, JSON.stringify(pub.data));
    const original = pub.data.quality;
    await s1.stop();

    const db = new DatabaseSync(join(dataDir, "skillforge.db"));
    const changed = db.prepare("UPDATE artifact_versions SET quality = json_remove(json_set(quality, '$.algorithm', 1), '$.hook')").run();
    db.close();
    assert.ok(changed.changes >= 1);

    s2 = await startServer({ SKILLFORGE_DATA_DIR: dataDir }, { prefix: "skillforge-hooks-s2-" });
    assert.ok(s2.up, s2.stderr);
    const card = await api(s2.base, "GET", "/api/v1/artifacts/hook/destructive-guard");
    assert.equal(card.status, 200);
    assert.equal(card.data.latest.quality.algorithm, 5);
    assert.deepEqual(card.data.latest.quality, original);
  } finally {
    if (s1?.up) await s1.stop();
    if (s2?.up) await s2.stop();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("Q_HOOK_* codes and the runtime catalog in the core; help for codes and risk labels", async () => {
  const core = await import(pathToFileURL(join(ROOT, "packages", "core", "dist", "index.js")).href);
  for (const code of HOOK_CODES) assert.ok(code in core.QUALITY_CODES, `QUALITY_CODES: missing ${code}`);
  assert.ok(Array.isArray(core.HOOK_RUNTIMES), "the core exports HOOK_RUNTIMES");
  const cc = core.HOOK_RUNTIMES.find((r) => r.runtime === "claude-code");
  assert.ok(cc && cc.events.includes("PreToolUse") && cc.types.includes("command"), JSON.stringify(cc));
  const topics = join(ROOT, "packages", "web", "src", "help", "topics");
  for (const code of HOOK_CODES) {
    const p = join(topics, "codes", `${code}.md`);
    assert.ok(existsSync(p), `no topic codes/${code}`);
    assert.ok(readFileSync(p, "utf8").includes("Advisory"), `codes/${code}: no "Advisory"`);
  }
  const risksTopic = join(topics, "getting-started", "hook-risks.md");
  assert.ok(existsSync(risksTopic), "no topic getting-started/hook-risks");
  const text = readFileSync(risksTopic, "utf8");
  for (const label of ["blocks_tools", "blocks_prompts", "writes_files", "network", "every_prompt", "llm_hook"]) {
    assert.ok(text.includes(label), `getting-started/hook-risks: no label ${label}`);
  }
  assert.match(text, /\bask\b/);
});
