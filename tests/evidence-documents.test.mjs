// A local text result as an evidence document: API, reading, limits, another user's blob, GC, CLI `--file`.
// Requires a build.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const REVIEW = "# Review\n\nOK";
const sha = (s) => createHash("sha256").update(s).digest("hex");
let srv;
let base;
let admin;
let alice;
let bob;
let work;

const skill = (name) => [
  {
    path: "SKILL.md",
    content_base64: Buffer.from(
      `---\nname: ${name}\ndescription: Skill ${name} for evidence document checks. Use when the user asks for ${name}.\n---\n\n# ${name}\n\nBody.\n`,
    ).toString("base64"),
  },
];
const evidenceOf = async (name) =>
  (await api(base, "GET", `/api/v1/artifacts/skill/${name}/versions/0.1.0`, undefined, { cookie: admin.cookie })).data.evidence;
const post = (name, body, auth) => api(base, "POST", `/api/v1/artifacts/skill/${name}/versions/0.1.0/evidence`, body, auth);

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 20000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-evdoc-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  await createUser(base, admin.cookie, { username: "bob", password: "bob-pw-123", role: "contributor" });
  alice = await login(base, "alice", "alice-pw-1");
  bob = await login(base, "bob", "bob-pw-123");
  for (const name of ["doc-skill", "other-skill", "cli-skill", "gate-skill"]) {
    const p = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: skill(name) }, { cookie: alice.cookie });
    assert.equal(p.status, 201, JSON.stringify(p.data));
  }
  work = mkdtempSync(join(tmpdir(), "skillforge-evdoc-work-"));
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("document is stored, read as text/plain, repeat is idempotent", async () => {
  const r = await post("doc-skill", { kind: "review", document: { name: "review.md", text: REVIEW } }, { cookie: alice.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rec = r.data.evidence.find((e) => e.document?.name === "review.md");
  assert.ok(rec, JSON.stringify(r.data.evidence));
  assert.equal(rec.document.size, 12);
  assert.equal(rec.document.sha256, sha(REVIEW));
  assert.equal(rec.url, `/api/v1/artifacts/skill/doc-skill/versions/0.1.0/evidence/documents/${sha(REVIEW)}`);

  const doc = await fetch(`${base}${rec.url}`, { headers: { cookie: bob.cookie } });
  assert.equal(doc.status, 200);
  assert.match(doc.headers.get("content-type") ?? "", /^text\/plain; charset=utf-8/);
  assert.equal(doc.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await doc.text(), REVIEW);

  const again = await post("doc-skill", { kind: "review", document: { name: "review.md", text: REVIEW } }, { cookie: alice.cookie });
  assert.equal(again.status, 200);
  assert.equal((await evidenceOf("doc-skill")).length, 1);
});

test("invalid documents — 400 document_invalid, evidence unchanged", async () => {
  const before = (await evidenceOf("doc-skill")).length;
  for (const body of [
    { kind: "run", document: { name: "big.md", text: "x".repeat(65537) } },
    { kind: "run", document: { name: "nul.md", text: "a\u0000b" } },
    { kind: "run", document: { name: "../x.md", text: "x" } },
    { kind: "run", url: "https://ci.example/1", document: { name: "x.md", text: "x" } },
  ]) {
    const r = await post("doc-skill", body, { cookie: alice.cookie });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.equal(r.data.error, "document_invalid", JSON.stringify(body).slice(0, 80));
  }
  const none = await post("doc-skill", { kind: "run" }, { cookie: alice.cookie });
  assert.equal(none.data.error, "url_invalid");
  assert.equal((await evidenceOf("doc-skill")).length, before);
});

test("permissions and channels: another contributor — 403 not_owner, MCP token — 403; MCP has no evidence tool", async () => {
  const foreign = await post("doc-skill", { kind: "run", document: { name: "x.md", text: "x" } }, { cookie: bob.cookie });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.data.error, "not_owner");
  const tok = await api(base, "POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, { cookie: alice.cookie });
  const viaMcp = await post("doc-skill", { kind: "run", document: { name: "x.md", text: "x" } }, { token: tok.data.token });
  assert.equal(viaMcp.status, 403);
  const tools = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok.data.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }).then((r) => r.json());
  assert.ok(!tools.result.tools.some((t) => /evidence/.test(t.name)));
});

test("another user's blob via the document path — 404", async () => {
  const otherFile = await api(base, "GET", "/api/v1/artifacts/skill/other-skill/versions/0.1.0", undefined, { cookie: admin.cookie });
  const foreignSha = otherFile.data.files[0].sha256;
  const r = await fetch(`${base}/api/v1/artifacts/skill/doc-skill/versions/0.1.0/evidence/documents/${foreignSha}`, { headers: { cookie: admin.cookie } });
  assert.equal(r.status, 404);
});

test("a gate document sets validated_at; GC with grace_days 0 keeps the document", async () => {
  const text = "# Verification\n\nall green";
  const r = await post("gate-skill", { kind: "gate", document: { name: "verification.md", text } }, { cookie: alice.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.validated_at);
  const gc = await api(base, "POST", "/api/v1/admin/blobs/gc", { dry_run: false, grace_days: 0 }, { cookie: admin.cookie });
  assert.equal(gc.status, 200, JSON.stringify(gc.data));
  const doc = await fetch(`${base}/api/v1/artifacts/skill/gate-skill/versions/0.1.0/evidence/documents/${sha(text)}`, { headers: { cookie: admin.cookie } });
  assert.equal(doc.status, 200);
  assert.equal(await doc.text(), text);
});

test("CLI: evidence add --file; both sources or a large file — exit code 2 without a request", async () => {
  const tok = await api(base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: alice.cookie });
  const env = { SKILLFORGE_URL: base, SKILLFORGE_TOKEN: tok.data.token };
  writeFileSync(join(work, "review.md"), "# CLI review\n");
  const ok = await runCli(["evidence", "add", "skill/cli-skill@0.1.0", "--kind", "review", "--file", "./review.md", "--json"], env);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /review\.md/);
  const doc = await fetch(`${base}/api/v1/artifacts/skill/cli-skill/versions/0.1.0/evidence/documents/${sha("# CLI review\n")}`, { headers: { cookie: admin.cookie } });
  assert.equal(doc.status, 200);

  const before = (await evidenceOf("cli-skill")).length;
  const both = await runCli(["evidence", "add", "skill/cli-skill@0.1.0", "--kind", "run", "--file", "./review.md", "--url", "https://ci.example/2"], env);
  assert.equal(both.code, 2, both.stderr);
  writeFileSync(join(work, "big.md"), "x".repeat(65537));
  const big = await runCli(["evidence", "add", "skill/cli-skill@0.1.0", "--kind", "run", "--file", "./big.md"], env);
  assert.equal(big.code, 2, big.stderr);
  assert.equal((await evidenceOf("cli-skill")).length, before);
});
