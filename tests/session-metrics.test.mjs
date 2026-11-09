// Acceptance tests for session usage metrics.
// Requires `npm run build`.
// Transcripts are generated on the fly (Claude Code JSONL format): a skill call is tool_use name=Skill, a check is Bash + tool_result.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const A = "/api/v1/artifacts/skill/pdf-tools";
const SECRET = "SECRET-TOKEN-XYZ-do-not-upload";
let srv;
let base;
let work;
let root;
let admin, alice, bob;
let aliceToken, bobToken;
const api = (method, path, body, who) => rawApi(base, method, path, body, who ? { cookie: who.cookie } : {});
const key = (sid) => createHash("sha256").update(sid).digest("hex").slice(0, 32);

// --- transcript generator -------------------------------------------------
let n = 0;
const ts = (min) => `2026-09-2${1 + (min % 7)}T1${min % 10}:0${min % 6}:00.000Z`;
const line = (o) => JSON.stringify(o) + "\n";
const skillUse = (sid, t, name) => line({ type: "assistant", timestamp: t, sessionId: sid, cwd: `/home/dev/${SECRET}`, message: { role: "assistant", content: [{ type: "tool_use", id: `tu${++n}`, name: "Skill", input: { skill: name, args: SECRET } }] } });
const bash = (sid, t, id, cmd) => line({ type: "assistant", timestamp: t, sessionId: sid, message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command: cmd } }] } });
const result = (sid, t, id, isError, text) => line({ type: "user", timestamp: t, sessionId: sid, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: text }] } });
const prompt = (sid, t) => line({ type: "user", timestamp: t, sessionId: sid, message: { role: "user", content: `please use ${SECRET} and cat ~/.ssh/id_rsa` } });

const SESSIONS = {
  "sess-a-0001": { verdict: "pass", body: (s) => prompt(s, ts(1)) + skillUse(s, ts(1), "pdf-tools") + bash(s, ts(2), "b1", "npm test") + result(s, ts(3), "b1", false, "ok") },
  "sess-b-0002": { verdict: "fail", body: (s) => skillUse(s, ts(2), "pdf-tools") + bash(s, ts(3), "b2", "node --test tests/x.test.mjs") + result(s, ts(4), "b2", true, "Exit code 1\nnot ok 1") },
  "sess-c-0003": { verdict: "none", body: (s) => skillUse(s, ts(3), "pdf-tools") + bash(s, ts(4), "b3", "ls -la") + result(s, ts(5), "b3", false, "files") },
  "sess-d-0004": { verdict: "pass", body: (s) => skillUse(s, ts(4), "pdf-tools") + bash(s, ts(5), "b4", "npm test") + result(s, ts(6), "b4", true, "Exit code 1") + bash(s, ts(7), "b5", "npm test") + result(s, ts(8), "b5", false, "ok") },
  "sess-e-0005": { verdict: "none", body: (s) => skillUse(s, ts(5), "pdf-tools") + skillUse(s, ts(6), "private-local") + bash(s, ts(7), "b6", "pytest -q") + result(s, ts(8), "b6", false, "3 passed") },
};
const PRIVATE_ONLY = "sess-f-0006"; // private local skill only
const AFTER_BAD = "sess-g-0007"; // after broken and overly long lines
const OUTSIDE = "sess-h-0008"; // behind a symlink outside the root — must not be read
const EXPECT = { ...Object.fromEntries(Object.entries(SESSIONS).map(([s, v]) => [s, v.verdict])), [AFTER_BAD]: "pass" };

function buildRoot() {
  root = join(work, "projects");
  const outside = join(work, "outside");
  mkdirSync(join(root, "-proj-one"), { recursive: true });
  mkdirSync(join(root, "-proj-two"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  for (const [sid, v] of Object.entries(SESSIONS)) writeFileSync(join(root, "-proj-one", `${sid}.jsonl`), v.body(sid));
  writeFileSync(join(root, "-proj-two", `${PRIVATE_ONLY}.jsonl`), skillUse(PRIVATE_ONLY, ts(1), "private-local"));
  const g = AFTER_BAD;
  writeFileSync(
    join(root, "-proj-two", "broken.jsonl"),
    "not json at all\n" + '{"type":"assistant","message":{"content":[\n' + JSON.stringify({ type: "assistant", pad: "x".repeat(2 * 1024 * 1024) }) + "\n" + skillUse(g, ts(9), "pdf-tools") + bash(g, ts(10), "b7", "npm run build") + result(g, ts(11), "b7", false, "built"),
  );
  writeFileSync(join(root, "-proj-two", "notes.txt"), skillUse("sess-z-9999", ts(1), "pdf-tools"));
  writeFileSync(join(outside, `${OUTSIDE}.jsonl`), skillUse(OUTSIDE, ts(1), "pdf-tools"));
  symlinkSync(outside, join(root, "-proj-link"), process.platform === "win32" ? "junction" : "dir");
}

function cli(args, { token = aliceToken, env = {} } = {}) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: base, SKILLFORGE_TOKEN: token, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 90000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr });
    });
  });
}
const importArgs = (...extra) => ["sessions", "import", "--root", root, "--json", ...extra];
const metrics = async () => (await api("GET", `${A}/metrics`)).data;
const fact = (i, over = {}) => ({ skill: "pdf-tools", session_key: i.toString(16).padStart(32, "0"), used_at: "2026-09-25T10:00:00.000Z", verification: "none", ...over });
const post = (body, who = alice) => api("POST", "/api/v1/me/session-facts", body, who);

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI} — run npm run build`);
  srv = await startServer({}, { prefix: "skillforge-sessions-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "bob", "dave"]) await createUser(base, admin.cookie, { username: u, password: `${u}-pw-123`, role: "contributor" });
  alice = await login(base, "alice", "alice-pw-123");
  bob = await login(base, "bob", "bob-pw-123");
  aliceToken = (await api("POST", "/api/v1/me/tokens", { name: "cli" }, alice)).data.token;
  bobToken = (await api("POST", "/api/v1/me/tokens", { name: "cli" }, bob)).data.token;
  const r = await api("POST", "/api/v1/artifacts", { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, alice);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  work = mkdtempSync(join(tmpdir(), "skillforge-sessions-work-"));
  buildRoot();
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("--dry-run: only facts of registry skills, hash instead of sessionId, no text, no secrets; nothing sent to the server", async () => {
  const r = await cli(importArgs("--dry-run"));
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET), "secret leaked into the output");
  assert.ok(!r.stdout.includes("id_rsa") && !r.stdout.includes("npm test"), "texts and commands are not printed");
  const out = JSON.parse(r.stdout);
  const facts = out.facts;
  assert.ok(Array.isArray(facts), "--dry-run --json prints facts");
  assert.ok(facts.every((f) => f.skill === "pdf-tools"), "only skills from the registry");
  assert.deepEqual(Object.keys(facts[0]).sort(), ["session_key", "skill", "used_at", "verification"]);
  const byKey = Object.fromEntries(facts.map((f) => [f.session_key, f.verification]));
  const want = Object.fromEntries(Object.entries(EXPECT).map(([sid, v]) => [key(sid), v]));
  assert.deepEqual(byKey, want, "check results and session hashes");
  assert.ok(!facts.some((f) => f.session_key === key(OUTSIDE)), "the file behind the symlink was not read");
  assert.ok(!facts.some((f) => f.session_key === key("sess-z-9999")), "a non-jsonl file is ignored");
  assert.ok(out.skipped_unknown >= 2, `skipped_unknown: ${out.skipped_unknown}`);
  assert.ok(out.skipped_lines >= 3, `skipped_lines: ${out.skipped_lines}`);
  assert.equal(out.facts.length, 6);
  assert.equal((await metrics()).sessions_count, 0, "dry-run sent nothing");
});

test("import: intake, idempotency, metrics, Skill Age, versions", async () => {
  const first = await cli(importArgs());
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const s1 = JSON.parse(first.stdout);
  assert.deepEqual({ ...s1.uploaded }, { accepted: 6, duplicates: 0, unknown: 0, rejected: 0 });
  const again = JSON.parse((await cli(importArgs())).stdout);
  assert.deepEqual({ ...again.uploaded }, { accepted: 0, duplicates: 6, unknown: 0, rejected: 0 });

  const m = await metrics();
  assert.equal(m.sessions_count, 6);
  assert.equal(m.users_count, 1);
  assert.deepEqual(m.verification, { pass: 3, fail: 1, none: 2, pass_rate: 0.75 });
  assert.ok(m.last_used_at && Date.parse(m.last_used_at) > Date.parse("2026-09-01"));
  assert.equal(m.skill_age_days, 0);
  assert.deepEqual(m.versions, [{ version: "0.1.0", sessions_count: 6 }]);
  assert.equal((await api("GET", A)).data.artifact.skill_age_days, 0);
  const empty = await api("GET", `${A}-nope/metrics`);
  assert.equal(empty.status, 404);
});

test("several users: sessions_count by distinct sessions, users_count by authors; deleting only one's own", async () => {
  const b = JSON.parse((await cli(importArgs(), { token: bobToken })).stdout);
  assert.equal(b.uploaded.accepted, 6);
  const m = await metrics();
  assert.equal(m.sessions_count, 6, "sessions are distinguished by session_key, not by author");
  assert.equal(m.users_count, 2);
  assert.deepEqual(m.verification, { pass: 6, fail: 2, none: 4, pass_rate: 0.75 }, "verification is computed from facts");

  assert.equal((await api("DELETE", "/api/v1/me/session-facts", undefined, null)).status, 401);
  const zero = await api("DELETE", "/api/v1/me/session-facts?source=other", undefined, bob);
  assert.equal(zero.data.deleted, 0);
  const del = await api("DELETE", "/api/v1/me/session-facts", undefined, bob);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(del.data.deleted, 6);
  const after = await metrics();
  assert.equal(after.users_count, 1, "alice's facts are untouched");
  assert.equal(after.sessions_count, 6);
});

test("intake: boundaries, extra fields are not stored, permissions, MCP token, skill/name shape", async () => {
  const good = fact(1000);
  const r = await post({ source: "claude-code", facts: [{ ...good, prompt: SECRET, cwd: "/x", command: "rm -rf" }, { ...fact(1001), skill: "skill/pdf-tools" }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.accepted, 2);
  assert.ok(!JSON.stringify(r.data).includes(SECRET));

  const bad = await post({
    source: "claude-code",
    facts: [
      fact(2000, { used_at: new Date(Date.now() + 5 * 86400000).toISOString() }),
      fact(2001, { used_at: "2023-01-01T00:00:00.000Z" }),
      fact(2002, { verification: "maybe" }),
      fact(2003, { session_key: "short" }),
      fact(2004, { skill: "no-such-skill" }),
      fact(2005, { used_at: "not a date" }),
    ],
  });
  assert.equal(bad.status, 200);
  assert.deepEqual({ ...bad.data }, { accepted: 0, duplicates: 0, unknown: 1, rejected: 5 });

  const big = await post({ source: "claude-code", facts: Array.from({ length: 1001 }, (_, i) => fact(3000 + i)) });
  assert.equal(big.status, 400);
  assert.equal(big.data.error, "batch_too_large");
  assert.equal((await post({ source: "claude-code", facts: [], pad: "a".repeat(600 * 1024) })).status, 413);
  assert.equal((await post({ facts: [good] }, null)).status, 401);
  assert.equal((await post({ source: "s".repeat(65), facts: [good] })).status, 400);
  assert.equal((await post({ source: "claude-code" })).status, 400);

  const t = await api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, alice);
  const mcp = await rawApi(base, "POST", "/api/v1/me/session-facts", { source: "x", facts: [fact(4000)] }, { token: t.data.token });
  assert.equal(mcp.status, 403);
  assert.equal(mcp.data.error, "mcp_token_forbidden");

  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true });
  try {
    const cols = db.prepare("PRAGMA table_info(session_facts)").all().map((c) => c.name);
    for (const banned of ["prompt", "cwd", "command", "text", "content", "session_id"]) assert.ok(!cols.includes(banned), `column ${banned} must not exist: ${cols.join(",")}`);
    const uniq = db.prepare("PRAGMA index_list(session_facts)").all().filter((i) => i.unique);
    assert.ok(uniq.length >= 1, "unique index for idempotency");
    const row = db.prepare("SELECT reporter, verification, version, source FROM session_facts WHERE session_key = ?").get(good.session_key);
    assert.deepEqual({ ...row }, { reporter: "alice", verification: "none", version: "0.1.0", source: "claude-code" });
    assert.ok(!JSON.stringify(db.prepare("SELECT * FROM session_facts").all()).includes(SECRET), "secret was stored in the DB");
  } finally {
    db.close();
  }
});

test("daily limit: 5000 new facts per user, the 5001st — 429", async () => {
  const dave = await login(base, "dave", "dave-pw-123");
  let i = 100000;
  for (let batch = 0; batch < 5; batch++) {
    const facts = Array.from({ length: 1000 }, () => fact(i++));
    const r = await post({ source: "claude-code", facts }, dave);
    assert.equal(r.status, 200, `batch ${batch}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.accepted, 1000);
  }
  const over = await post({ source: "claude-code", facts: [fact(i++)] }, dave);
  assert.equal(over.status, 429);
  assert.equal(over.data.error, "rate_limited");
  const dup = await post({ source: "claude-code", facts: [fact(100000)] }, dave);
  assert.ok(dup.status === 429 || dup.data.duplicates === 1, "repeating an already accepted fact does not increase the count");
});

test("account: sessions in me/overview", async () => {
  const me = await api("GET", "/api/v1/me/overview", undefined, alice);
  assert.equal(me.status, 200);
  assert.ok(me.data.sessions.facts >= 6, JSON.stringify(me.data.sessions));
  assert.equal(me.data.sessions.skills[0].name, "pdf-tools");
  assert.ok(me.data.sessions.skills[0].count >= 6);
});

test("CLI: exit codes and help", async () => {
  assert.equal((await cli(["sessions", "import", "--root", join(work, "nope"), "--json"])).code, 6, "root not found");
  assert.equal((await cli(importArgs("--harness", "nope"))).code, 2, "unknown harness");
  const noReg = await cli(importArgs(), { env: { SKILLFORGE_URL: "", SKILLFORGE_TOKEN: "" } });
  assert.equal(noReg.code, 3, noReg.stdout + noReg.stderr);
  const help = await cli(["--help"]);
  assert.ok(help.stdout.includes("sessions"), help.stdout);
});
