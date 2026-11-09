// Acceptance tests for artifact quality assessment as a prompt
// (`assessQuality`, `Q_*` codes), storage in the version, backfill at startup, help for the codes.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { startServer, api, login, loadDir, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const QDIR = join(ROOT, "tests", "fixtures", "quality");
const strongFiles = () => toB64(loadDir(join(QDIR, "strong")));
const weakFiles = () => toB64(loadDir(join(QDIR, "weak")));
const WEAK_SKILL = readFileSync(join(QDIR, "weak", "quality-weak", "SKILL.md"), "utf8");
const lineOf = (text, needle) => text.split(/\r?\n/).findIndex((l) => l.includes(needle)) + 1;

const CODES = [
  "Q_DESC_SHORT",
  "Q_DESC_NO_TRIGGER",
  "Q_DESC_NO_BOUNDARY",
  "Q_DESC_PERSON",
  "Q_BODY_LONG",
  "Q_REF_DEEP",
  "Q_TIME_SENSITIVE",
  "Q_WINDOWS_PATH",
  "Q_TOOLS_UNBOUNDED",
  "Q_NO_EXAMPLE",
];
const WARN = new Set(["Q_DESC_SHORT", "Q_DESC_NO_TRIGGER", "Q_BODY_LONG", "Q_REF_DEEP", "Q_WINDOWS_PATH", "Q_TOOLS_UNBOUNDED"]);

let srv;
let base;
let admin;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-quality-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

const codesOf = (q) => q.checks.map((c) => c.code).sort();
const check = (q, code) => q.checks.find((c) => c.code === code);

function assertReportShape(q) {
  assert.ok(q && typeof q === "object", `no quality report: ${JSON.stringify(q)}`);
  // The algorithm version grows together with the rules; the contract is an integer ≥ 1.
  assert.ok(Number.isInteger(q.algorithm) && q.algorithm >= 1, `algorithm: ${q.algorithm}`);
  assert.ok(Number.isInteger(q.score) && q.score >= 0 && q.score <= 100);
  assert.ok(["A", "B", "C", "D"].includes(q.grade));
  for (const c of q.checks) {
    assert.ok(CODES.includes(c.code), `unknown code ${c.code}`);
    assert.equal(c.severity, WARN.has(c.code) ? "warn" : "info", `level of ${c.code}`);
    assert.ok(typeof c.message === "string" && c.message.length > 0);
    assert.ok(Array.isArray(c.hits) && c.hits.length <= 20);
  }
  const warn = q.checks.filter((c) => c.severity === "warn").length;
  const info = q.checks.filter((c) => c.severity === "info").length;
  assert.equal(q.score, Math.max(0, 100 - 15 * warn - 5 * info), "scale: 100 − 15·warn − 5·info");
  const grade = q.score >= 90 ? "A" : q.score >= 75 ? "B" : q.score >= 60 ? "C" : "D";
  assert.equal(q.grade, grade);
  for (const k of ["description_chars", "description_words", "body_chars", "body_tokens_est", "markdown_files", "reference_depth", "code_blocks"]) {
    assert.ok(Number.isInteger(q.metrics[k]), `metrics.${k}`);
  }
  assert.equal(q.metrics.body_tokens_est, Math.ceil(q.metrics.body_chars / 4));
}

test("validate: a strong skill — grade A, no warn, link depth 1, a Windows path in a powershell block does not count", async () => {
  const r = await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: strongFiles() }, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.errors, []);
  const q = r.data.quality;
  assertReportShape(q);
  assert.equal(q.grade, "A", JSON.stringify(q.checks));
  assert.ok(!q.checks.some((c) => c.severity === "warn"), JSON.stringify(q.checks));
  assert.equal(check(q, "Q_WINDOWS_PATH"), undefined);
  assert.equal(q.metrics.reference_depth, 1);
  assert.equal(q.metrics.code_blocks, 2);
  assert.equal(q.metrics.markdown_files, 2);
  const card = await api(base, "GET", "/api/v1/artifacts/skill/quality-strong", undefined, { cookie: admin.cookie });
  assert.equal(card.status, 404, "validate does not create an artifact");
});

test("validate: a weak skill — eight codes with trigger locations, score 10, grade D, publishing is not blocked", async () => {
  const r = await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: weakFiles() }, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true, "quality assessment does not make the artifact invalid");
  assert.deepEqual(r.data.errors, []);
  assert.ok(!r.data.warnings.some((w) => String(w.code).startsWith("Q_")), "quality codes do not end up in warnings");
  const q = r.data.quality;
  assertReportShape(q);
  assert.deepEqual(
    codesOf(q),
    ["Q_DESC_NO_BOUNDARY", "Q_DESC_NO_TRIGGER", "Q_DESC_SHORT", "Q_NO_EXAMPLE", "Q_REF_DEEP", "Q_TIME_SENSITIVE", "Q_TOOLS_UNBOUNDED", "Q_WINDOWS_PATH"],
  );
  assert.equal(q.score, 10);
  assert.equal(q.grade, "D");
  const time = check(q, "Q_TIME_SENSITIVE").hits;
  assert.ok(time.some((h) => h.path.endsWith("quality-weak/SKILL.md") && h.line === lineOf(WEAK_SKILL, "As of March 2025")), JSON.stringify(time));
  const win = check(q, "Q_WINDOWS_PATH").hits;
  assert.ok(win.some((h) => h.path.endsWith("quality-weak/SKILL.md") && h.line === lineOf(WEAK_SKILL, "scripts\\extract.py")), JSON.stringify(win));
  const deep = check(q, "Q_REF_DEEP").hits;
  assert.ok(deep.some((h) => h.path.endsWith("references/A.md")), JSON.stringify(deep));
  assert.equal(q.metrics.reference_depth, 2);
  assert.equal(q.metrics.code_blocks, 0);
});

test("publish: the report is stored in the version and matches in the card, the version list and the summary", async () => {
  const v = await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: weakFiles() }, { cookie: admin.cookie });
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: weakFiles() }, { cookie: admin.cookie });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  assert.deepEqual(pub.data.quality, v.data.quality);
  const card = await api(base, "GET", "/api/v1/artifacts/skill/quality-weak", undefined, { cookie: admin.cookie });
  assert.equal(card.status, 200);
  assert.deepEqual(card.data.latest.quality, pub.data.quality);
  // content-security-scan: the summary also carries the scan verdict.
  assert.deepEqual(card.data.artifact.quality, { score: 10, grade: "D", security: "pass", context: "low" });
  const versions = await api(base, "GET", "/api/v1/artifacts/skill/quality-weak/versions", undefined, { cookie: admin.cookie });
  const items = versions.data.items ?? versions.data;
  assert.deepEqual(items[0].quality, pub.data.quality);
  const list = await api(base, "GET", "/api/v1/artifacts?type=skill&q=quality-weak", undefined, { cookie: admin.cookie });
  const row = list.data.items.find((a) => a.name === "quality-weak");
  assert.deepEqual(row.quality, { score: 10, grade: "D", security: "pass", context: "low" });
});

test("a first-person description and a long body; a command with unrestricted Bash and a Windows path is published", async () => {
  const body = "Summarize the report section by section and keep the headings of the original document.\n".repeat(240);
  const long = `---\nname: long-summary\ndescription: I can help you summarize long reports. Use when asked for a summary of a long report.\n---\n\n# Long summary\n\n${body}`;
  const r = await api(base, "POST", "/api/v1/artifacts/validate", { type: "skill", files: [{ path: "SKILL.md", content_base64: Buffer.from(long).toString("base64") }] }, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assertReportShape(r.data.quality);
  assert.ok(check(r.data.quality, "Q_DESC_PERSON"), JSON.stringify(r.data.quality.checks));
  assert.ok(check(r.data.quality, "Q_BODY_LONG"));
  assert.ok(r.data.quality.metrics.body_tokens_est > 5000);
  assert.equal(check(r.data.quality, "Q_DESC_NO_TRIGGER"), undefined, "'Use when asked' is an applicability condition");

  const cmd =
    "---\nname: dump-out\ndescription: Dumps the current build output into a text file for review. Use when the user asks to save build output.\nallowed-tools: Read, Bash\n---\n\nSave the output to C:\\tmp\\out.txt and show the path.\n";
  const p = await api(base, "POST", "/api/v1/artifacts", { type: "command", files: [{ path: "dump-out.md", content_base64: Buffer.from(cmd).toString("base64") }] }, { cookie: admin.cookie });
  assert.equal(p.status, 201, `a command with quality remarks is published: ${p.status} ${JSON.stringify(p.data)}`);
  assertReportShape(p.data.quality);
  assert.ok(check(p.data.quality, "Q_TOOLS_UNBOUNDED"));
  assert.ok(check(p.data.quality, "Q_WINDOWS_PATH"));
  assert.equal(check(p.data.quality, "Q_REF_DEEP"), undefined, "Q_REF_DEEP only for skill");
});

test("backfill at startup: a cleared report is restored before the first request", async () => {
  // Both servers are stopped in finally: a failed check must not leave a process holding the database (otherwise the test
  // hangs).
  const dataDir = mkdtempSync(join(tmpdir(), "skillforge-quality-backfill-"));
  let s1;
  let s2;
  try {
    s1 = await startServer({ SKILLFORGE_DATA_DIR: dataDir }, { prefix: "skillforge-quality-s1-" });
    assert.ok(s1.up, s1.stderr);
    const a1 = await login(s1.base, "admin", ADMIN_PASSWORD);
    const pub = await api(s1.base, "POST", "/api/v1/artifacts", { type: "skill", files: strongFiles() }, { cookie: a1.cookie });
    assert.equal(pub.status, 201, JSON.stringify(pub.data));
    const original = pub.data.quality;
    assertReportShape(original);
    await s1.stop();

    const db = new DatabaseSync(join(dataDir, "skillforge.db"));
    const changed = db.prepare("UPDATE artifact_versions SET quality = NULL").run();
    db.close();
    assert.ok(changed.changes >= 1);

    s2 = await startServer({ SKILLFORGE_DATA_DIR: dataDir }, { prefix: "skillforge-quality-s2-" });
    assert.ok(s2.up, s2.stderr);
    const card = await api(s2.base, "GET", "/api/v1/artifacts/skill/quality-strong");
    assert.equal(card.status, 200);
    assert.deepEqual(card.data.latest.quality, original);
  } finally {
    if (s1?.up) await s1.stop();
    if (s2?.up) await s2.stop();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("the QUALITY_CODES registry in the core and an 'Advisory' help topic for every code", async () => {
  const core = await import(pathToFileURL(join(ROOT, "packages", "core", "dist", "index.js")).href);
  assert.ok(core.QUALITY_CODES, "the core exports QUALITY_CODES");
  // The registry may be extended (Q_HOOK_*); the existing codes must remain in it.
  for (const code of CODES) assert.ok(code in core.QUALITY_CODES, `QUALITY_CODES: missing ${code}`);
  assert.equal(typeof core.assessQuality, "function");
  for (const code of CODES) {
    const p = join(ROOT, "packages", "web", "src", "help", "topics", "codes", `${code}.md`);
    assert.ok(existsSync(p), `no help topic codes/${code}`);
    assert.ok(readFileSync(p, "utf8").includes("Advisory"), `codes/${code}: no 'Advisory' level`);
  }
});
