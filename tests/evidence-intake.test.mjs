// Acceptance tests for evidence intake.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const A = "/api/v1/artifacts/skill/pdf-tools";
let srv;
let base;
let work;
let admin, alice, bob, vera, rita, zed;
let aliceToken, bobToken, aliceMcp;
const api = (method, path, body, who) => rawApi(base, method, path, body, { cookie: (who ?? admin).cookie });
const anon = (method, path, body) => rawApi(base, method, path, body, {});
const skillFiles = loadDir(join(FIXTURES, "skill-standard"));
const withExtra = (line) =>
  skillFiles.map((f) => (f.path.endsWith("SKILL.md") ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + `\n${line}\n`) } : f));
const publish = (version, extra) => api("POST", "/api/v1/artifacts", { type: "skill", version, files: toB64(withExtra(extra)) }, alice);
const evidence = (version, body, who) => api("POST", `${A}/versions/${version}/evidence`, body, who ?? alice);
const usage = (body, who) => api("POST", `${A}/usage`, body, who ?? alice);
const version = async (v) => (await api("GET", `${A}/versions/${v}`)).data;
const audit = async () => (await api("GET", `${A}/audit`)).data.items;

function cli(args, token) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: base, SKILLFORGE_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 60000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr });
    });
  });
}

let nextId = 1;
async function tool(token, name, args) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
  });
  assert.equal(r.status, 200, `tools/call ${name}: ${r.status}`);
  return (await r.json()).result;
}
async function toolsList(token) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/list" }),
  });
  return (await r.json()).result.tools.map((t) => t.name);
}

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI} — run npm run build`);
  srv = await startServer({}, { prefix: "skillforge-evidence-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["bob", "contributor"], ["vera", "viewer"], ["rita", "reviewer"], ["zed", "viewer"]]) {
    await createUser(base, admin.cookie, { username: u, password: `${u}-pw-123`, role });
  }
  [alice, bob, vera, rita, zed] = await Promise.all(["alice", "bob", "vera", "rita", "zed"].map((u) => login(base, u, `${u}-pw-123`)));
  const token = async (who, body) => (await api("POST", "/api/v1/me/tokens", body, who)).data.token;
  aliceToken = await token(alice, { name: "cli" });
  bobToken = await token(bob, { name: "cli" });
  aliceMcp = await token(alice, { name: "agent", mcp: true });
  for (const [v, x] of [["0.1.0", "v1"], ["0.2.0", "v2"], ["0.3.0", "v3"]]) assert.equal((await publish(v, x)).status, 201);
  work = mkdtempSync(join(tmpdir(), "skillforge-evidence-work-"));
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("evidence: owner adds, server sets at/by, repeat is idempotent, gate sets validated_at, other kinds do not", async () => {
  assert.equal((await version("0.1.0")).validated_at, null);
  const body = { kind: "gate", url: "https://ci.example/run/42", summary: "npm test: 18 pass", at: "2001-01-01T00:00:00Z", by: "root" };
  const r = await evidence("0.1.0", body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const rec = r.data.evidence.find((e) => e.url === body.url);
  assert.equal(rec.kind, "gate");
  assert.equal(rec.summary, "npm test: 18 pass");
  assert.equal(rec.by, "alice", "author comes from the request, not from the body");
  assert.notEqual(rec.at, "2001-01-01T00:00:00Z", "time is set by the server");
  assert.ok(Math.abs(Date.now() - Date.parse(rec.at)) < 60000);
  assert.ok(r.data.validated_at, "gate sets validated_at");
  const again = await evidence("0.1.0", { kind: "gate", url: body.url });
  assert.equal(again.status, 200);
  assert.equal(again.data.evidence.filter((e) => e.url === body.url).length, 1);
  assert.equal((await version("0.1.0")).evidence.length, 1);

  for (const kind of ["run", "diff", "review", "eval"]) {
    const x = await evidence("0.2.0", { kind, url: `https://x.example/${kind}` });
    assert.equal(x.status, 201, `${kind}: ${JSON.stringify(x.data)}`);
  }
  assert.equal((await version("0.2.0")).validated_at, null, "run/diff/review/eval do not touch validated_at");
  assert.ok((await audit()).some((e) => e.action === "evidence_add" && e.actor === "alice"));
  assert.equal((await evidence("latest", { kind: "run", url: "https://x.example/latest" })).status, 201, "latest is allowed");
});

test("evidence: invalid input is rejected at the boundary", async () => {
  const before = (await version("0.3.0")).evidence.length;
  const bad = [
    [{ kind: "magic", url: "https://x.example/1" }, "kind_invalid"],
    [{ url: "https://x.example/1" }, "kind_invalid"],
    [{ kind: "gate", url: "javascript:alert(1)" }, "url_invalid"],
    [{ kind: "gate", url: "data:text/html,x" }, "url_invalid"],
    [{ kind: "gate", url: "ftp://x.example/1" }, "url_invalid"],
    [{ kind: "gate", url: "//evil.example/x" }, "url_invalid"],
    [{ kind: "gate" }, "url_invalid"],
    [{ kind: "gate", url: "https://x.example/" + "a".repeat(2049) }, "url_invalid"],
  ];
  for (const [body, code] of bad) {
    const r = await evidence("0.3.0", body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(r.data.error, code, JSON.stringify(body).slice(0, 80));
  }
  assert.equal((await evidence("0.3.0", { kind: "gate", url: "https://x.example/ok", summary: "s".repeat(501) })).status, 400);
  assert.equal((await evidence("9.9.9", { kind: "gate", url: "https://x.example/ok" })).status, 404);
  assert.equal((await version("0.3.0")).evidence.length, before, "nothing was written");
  assert.equal((await evidence("0.3.0", { kind: "gate", url: "/api/v1/ext/x/run/1" })).status, 201, "registry path is allowed");
});

test("evidence: permissions — non-owner, viewer, anonymous, MCP token; reviewer — override with audit", async () => {
  const body = { kind: "run", url: "https://x.example/perm" };
  const b = await evidence("0.3.0", body, bob);
  assert.equal(b.status, 403);
  assert.equal(b.data.error, "not_owner");
  assert.equal((await evidence("0.3.0", body, vera)).status, 403);
  assert.equal((await anon("POST", `${A}/versions/0.3.0/evidence`, body)).status, 401);
  const m = await rawApi(base, "POST", `${A}/versions/0.3.0/evidence`, body, { token: aliceMcp });
  assert.equal(m.status, 403);
  assert.equal(m.data.error, "mcp_token_forbidden");
  const r = await evidence("0.3.0", body, rita);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok((await audit()).some((e) => e.action === "publish_override" && e.actor === "rita"));
});

test("evidence: no more than 100 records per version", async () => {
  const have = (await version("0.1.0")).evidence.length;
  for (let i = have; i < 100; i++) assert.equal((await evidence("0.1.0", { kind: "run", url: `https://x.example/bulk/${i}` })).status, 201);
  const over = await evidence("0.1.0", { kind: "run", url: "https://x.example/bulk/over" });
  assert.equal(over.status, 409);
  assert.equal(over.data.error, "evidence_limit");
});

test("usage: counters, Transfer Rate, report_id idempotency, boundaries", async () => {
  const a = await usage({ version: "0.1.0", uses: 10, helped: 7, report_id: "r1", source: "reckon" });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(a.data.use_count, 10);
  assert.equal(a.data.help_count, 7);
  const b = await usage({ version: "0.1.0", uses: 5, helped: 5 }, vera); // a viewer can report too
  assert.equal(b.status, 201, JSON.stringify(b.data));
  assert.equal(b.data.use_count, 15);
  assert.equal(b.data.help_count, 12);
  assert.equal(b.data.transfer_rate, 0.8);
  const dup = await usage({ version: "0.1.0", uses: 10, helped: 7, report_id: "r1" });
  assert.equal(dup.status, 200);
  assert.equal(dup.data.use_count, 15, "repeated report_id does not double-count");
  const other = await usage({ version: "0.1.0", uses: 1, helped: 0, report_id: "r1" }, bob);
  assert.equal(other.status, 201, "report_id is unique per author");

  for (const body of [{ uses: 3, helped: 4 }, { uses: -1, helped: 0 }, { uses: 100001, helped: 0 }, { uses: 1.5, helped: 1 }, { uses: "3", helped: 1 }, { helped: 1 }, { uses: 1, helped: 0, report_id: "x".repeat(129) }, { uses: 1, helped: 0, source: "s".repeat(65) }]) {
    const r = await usage({ version: "0.1.0", ...body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 70));
    assert.equal(r.data.error, "usage_invalid");
  }
  assert.equal((await usage({ version: "9.9.9", uses: 1, helped: 0 })).status, 404);
  assert.equal((await anon("POST", `${A}/usage`, { uses: 1, helped: 0 })).status, 401);

  const v = await version("0.1.0");
  assert.deepEqual(v.usage, { uses: 16, helped: 12, transfer_rate: 0.75 });
  assert.equal(v.use_count, 16);
  const zero = await version("0.2.0");
  assert.deepEqual(zero.usage, { uses: 0, helped: 0, transfer_rate: null });
});

test("usage: latest by default; per-version summary and total; card", async () => {
  const d = await usage({ uses: 4, helped: 1 });
  assert.equal(d.status, 201, JSON.stringify(d.data));
  assert.equal(d.data.version, "0.3.0", "latest = 0.3.0");
  const s = await anon("GET", `${A}/usage`);
  assert.equal(s.status, 200, "reading follows the public-read rule");
  const by = Object.fromEntries(s.data.versions.map((x) => [x.version, x]));
  assert.equal(by["0.1.0"].uses, 16);
  assert.equal(by["0.3.0"].uses, 4);
  assert.deepEqual(s.data.total, { uses: 20, helped: 13, transfer_rate: 0.65 });
  const card = (await api("GET", A)).data;
  assert.deepEqual(card.usage_total, { uses: 20, helped: 13, transfer_rate: 0.65 });
});

test("usage: no more than 200 reports per day per (author, artifact) pair", async () => {
  for (let i = 0; i < 200; i++) {
    const r = await usage({ version: "0.2.0", uses: 1, helped: 0 }, zed);
    assert.equal(r.status, 201, `report ${i}: ${JSON.stringify(r.data)}`);
  }
  const over = await usage({ version: "0.2.0", uses: 1, helped: 0 }, zed);
  assert.equal(over.status, 429);
  assert.equal(over.data.error, "rate_limited");
  assert.equal((await version("0.2.0")).usage.uses, 200, "the 201st is not counted");
});

test("CLI: report-usage and evidence add — codes, JSON, not_owner", async () => {
  let r = await cli(["report-usage", "skill/pdf-tools", "--version", "0.3.0", "--uses", "10", "--helped", "7", "--json"], aliceToken);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.version, "0.3.0");
  assert.equal(body.use_count, 14);
  assert.equal(body.help_count, 8);
  assert.equal(body.transfer_rate, 0.571);
  r = await cli(["report-usage", "skill/pdf-tools", "--uses", "3", "--helped", "5"], aliceToken);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  r = await cli(["report-usage", "skill/nope", "--uses", "1", "--helped", "0"], aliceToken);
  assert.equal(r.code, 6, r.stdout + r.stderr);

  r = await cli(["evidence", "add", "skill/pdf-tools@0.3.0", "--kind", "gate", "--url", "https://ci.example/cli/1", "--summary", "from cli", "--json"], aliceToken);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  r = await cli(["evidence", "add", "skill/pdf-tools@0.3.0", "--kind", "gate", "--url", "https://ci.example/cli/2"], bobToken);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.ok(r.stderr.includes("alice"), r.stderr);
  r = await cli(["evidence", "add", "skill/pdf-tools@0.3.0", "--kind", "magic", "--url", "https://ci.example/cli/3"], aliceToken);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  const help = await cli(["--help"], aliceToken);
  assert.ok(help.stdout.includes("report-usage") && help.stdout.includes("evidence"), help.stdout);
});

test("MCP: record_usage exists, evidence via MCP does not; visibility rules and boundaries; author and source in the DB", async () => {
  assert.equal((await api("POST", `${A}/transitions`, { to: "active", reason: "mcp" })).status, 200);
  const names = await toolsList(aliceMcp);
  assert.ok(names.includes("record_usage"), names.join(","));
  assert.ok(!names.some((n) => /evidence/i.test(n)), `evidence via MCP is not accepted: ${names.join(",")}`);

  const ok = await tool(aliceMcp, "record_usage", { type: "skill", name: "pdf-tools", version: "0.2.0", uses: 3, helped: 2, report_id: "m1" });
  assert.ok(!ok.isError, JSON.stringify(ok));
  assert.equal(ok.structuredContent.use_count, 203);
  assert.equal(ok.structuredContent.help_count, 2);
  const again = await tool(aliceMcp, "record_usage", { type: "skill", name: "pdf-tools", version: "0.2.0", uses: 3, helped: 2, report_id: "m1" });
  assert.equal(again.structuredContent.use_count, 203, "repeated report_id does not double-count");
  for (const args of [{ uses: 1, helped: 2 }, { uses: -1, helped: 0 }, { uses: 100001, helped: 0 }]) {
    const r = await tool(aliceMcp, "record_usage", { type: "skill", name: "pdf-tools", ...args });
    assert.equal(r.isError, true, JSON.stringify(args));
  }
  assert.equal((await tool(aliceMcp, "record_usage", { type: "skill", name: "nope", uses: 1, helped: 0 })).isError, true);

  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true });
  try {
    const row = db.prepare("SELECT reporter, source, uses, helped FROM artifact_usage_reports WHERE report_id = 'm1'").get();
    assert.deepEqual({ ...row }, { reporter: "alice", source: "mcp", uses: 3, helped: 2 });
    const rk = db.prepare("SELECT source FROM artifact_usage_reports WHERE report_id = 'r1' AND reporter = 'alice'").get();
    assert.equal(rk.source, "reckon");
  } finally {
    db.close();
  }
});

test("MCP: a candidate artifact is not available, as if nonexistent", async () => {
  const files = skillFiles.map((f) => ({ path: f.path.replace("pdf-tools", "cand-skill"), content: f.path.endsWith("SKILL.md") ? Buffer.from(f.content.toString("utf8").replace(/^name: pdf-tools$/m, "name: cand-skill")) : f.content }));
  assert.equal((await api("POST", "/api/v1/artifacts", { type: "skill", version: "0.1.0", files: toB64(files) }, alice)).status, 201);
  const r = await tool(aliceMcp, "record_usage", { type: "skill", name: "cand-skill", uses: 1, helped: 0 });
  assert.equal(r.isError, true);
  assert.equal((await api("GET", "/api/v1/artifacts/skill/cand-skill/usage")).data.total.uses, 0);
});
