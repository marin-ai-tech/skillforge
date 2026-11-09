// Acceptance tests for the registry MCP endpoint `POST /mcp`:
// consumer consent via a token, tools, the `skillforge mcp` CLI bridge. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const PDF_SKILL = readFileSync(join(FIXTURES, "skill-standard", "pdf-tools", "SKILL.md"), "utf8");
const PDF_REF = readFileSync(join(FIXTURES, "skill-standard", "pdf-tools", "references", "REFERENCE.md"), "utf8");
const skillMd = (name, tag) =>
  `---\nname: ${name}\ndescription: Team notes skill ${name} for MCP checks. Use when the user asks for ${tag} notes.\ntags: [${tag}]\n---\n\n# ${name}\n\nNotes body for ${name}.\n`;

let srv;
let base;
let admin;
let alice;
let mcpToken; // mcp: true, no tags
let tagToken; // mcp: true, mcp_tags: [team-a]
let plainToken; // no consent
let work;

async function publishSkill(files) {
  const r = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files }, { cookie: admin.cookie });
  assert.equal(r.status, 201, `publish: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function activate(name) {
  const t = await api(base, "POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active", reason: "mcp test" }, { cookie: admin.cookie });
  assert.equal(t.status, 200, `transition ${name}: ${t.status} ${JSON.stringify(t.data)}`);
}
async function token(body) {
  const r = await api(base, "POST", "/api/v1/me/tokens", body, { cookie: alice.cookie });
  assert.equal(r.status, 201, `token: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function rpc(tok, body, headers = {}, method = "POST") {
  const r = await fetch(`${base}/mcp`, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(tok ? { authorization: `Bearer ${tok}` } : {}),
      ...headers,
    },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { status: r.status, headers: r.headers, json, text };
}
let nextId = 1;
const req = (method, params) => ({ jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) });
async function callTool(tok, name, args) {
  const r = await rpc(tok, req("tools/call", { name, arguments: args }));
  assert.equal(r.status, 200, `tools/call ${name}: ${r.status} ${r.text}`);
  // The tool result is inside the JSON-RPC `result` (an earlier version of the helper wrongly read fields from the top level
  // of the response).
  assert.equal(r.json.error, undefined, `tools/call ${name}: JSON-RPC error ${r.text}`);
  const extra = Object.keys(r.json).filter((k) => !["jsonrpc", "id", "result"].includes(k));
  assert.deepEqual(extra, [], `the JSON-RPC response contains extra top-level fields: ${extra.join(", ")}`);
  return r.json.result;
}

function runCli(args, { env = {}, stdin = "", timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: undefined, SKILLFORGE_TOKEN: undefined, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.end(stdin);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-mcp-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  alice = await login(base, "alice", "alice-pw-1");

  await publishSkill(toB64(loadDir(join(FIXTURES, "skill-standard"))));
  await activate("pdf-tools");
  for (const [name, tag] of [["team-a-notes", "team-a"], ["team-b-notes", "team-b"]]) {
    await publishSkill([{ path: "SKILL.md", content_base64: Buffer.from(skillMd(name, tag)).toString("base64") }]);
    await activate(name);
  }
  // A candidate with the tag team-a: not visible even to a token with this tag.
  await publishSkill([{ path: "SKILL.md", content_base64: Buffer.from(skillMd("draft-notes", "team-a")).toString("base64") }]);

  mcpToken = await token({ name: "agent", mcp: true });
  tagToken = await token({ name: "agent-team-a", mcp: true, mcp_tags: ["team-a"] });
  plainToken = await token({ name: "ci" });
  work = mkdtempSync(join(tmpdir(), "skillforge-mcp-work-"));
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("tokens: MCP consent and tags are saved; invalid values → 400", async () => {
  assert.equal(mcpToken.mcp, true);
  assert.deepEqual(mcpToken.mcp_tags, []);
  assert.deepEqual(tagToken.mcp_tags, ["team-a"]);
  assert.equal(plainToken.mcp, false);
  const list = await api(base, "GET", "/api/v1/me/tokens", undefined, { cookie: alice.cookie });
  const byName = Object.fromEntries(list.data.items.map((t) => [t.name, t]));
  assert.equal(byName["agent"].mcp, true);
  assert.deepEqual(byName["agent-team-a"].mcp_tags, ["team-a"]);
  assert.equal(byName["ci"].mcp, false);
  const bad = await api(base, "POST", "/api/v1/me/tokens", { name: "x", mcp: true, mcp_tags: ["Bad Tag"] }, { cookie: alice.cookie });
  assert.equal(bad.status, 400);
  const noConsent = await api(base, "POST", "/api/v1/me/tokens", { name: "y", mcp_tags: ["team-a"] }, { cookie: alice.cookie });
  assert.equal(noConsent.status, 400, "tags without mcp: true");
});

test("handshake: initialize, notification 202, tools/list, version negotiation", async () => {
  const init = await rpc(mcpToken.token, req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }));
  assert.equal(init.status, 200, init.text);
  assert.match(init.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(init.json.jsonrpc, "2.0");
  assert.equal(init.json.result.protocolVersion, "2025-06-18");
  assert.equal(init.json.result.serverInfo.name, "skillforge");
  assert.ok(init.json.result.capabilities.tools);
  const note = await rpc(mcpToken.token, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  assert.equal(note.text, "");
  const list = await rpc(mcpToken.token, req("tools/list"));
  const names = list.json.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_artifact", "read_artifact_file", "record_usage", "search_artifacts"]);
  for (const t of list.json.result.tools) {
    assert.ok(t.description && t.inputSchema && t.inputSchema.type === "object", JSON.stringify(t));
  }
  const old = await rpc(mcpToken.token, req("initialize", { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
  assert.equal(old.json.result.protocolVersion, "2025-11-25");
  const ping = await rpc(mcpToken.token, req("ping"));
  assert.deepEqual(ping.json.result, {});
});

test("protocol errors: -32601, -32602, -32600, 400/-32700; GET and DELETE → 405", async () => {
  const unknown = await rpc(mcpToken.token, req("resources/templates/list"));
  assert.equal(unknown.json.error.code, -32601);
  const badTool = await rpc(mcpToken.token, req("tools/call", { name: "drop_table", arguments: {} }));
  assert.equal(badTool.json.error.code, -32602);
  const batch = await rpc(mcpToken.token, [req("ping"), req("ping")]);
  assert.equal(batch.json.error.code, -32600);
  const parse = await rpc(mcpToken.token, "{not json");
  assert.equal(parse.status, 400);
  assert.equal(parse.json.error.code, -32700);
  for (const m of ["GET", "DELETE"]) {
    const r = await rpc(mcpToken.token, undefined, {}, m);
    assert.equal(r.status, 405, `${m} /mcp`);
  }
  for (const args of [{ type: "nope", name: "x" }, { type: "skill", name: "Bad Name" }, { type: "skill", name: "pdf-tools", version: "latest" }]) {
    const r = await rpc(mcpToken.token, req("tools/call", { name: "get_artifact", arguments: args }));
    assert.equal(r.json.error?.code, -32602, `invalid arguments ${JSON.stringify(args)}: ${r.text}`);
  }
  const bigLimit = await rpc(mcpToken.token, req("tools/call", { name: "search_artifacts", arguments: { limit: 500 } }));
  assert.equal(bigLimit.json.error?.code, -32602);
});

test("access: only a Bearer token with consent; cookie, Origin, revoked token — denied", async () => {
  const init = () => req("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  const none = await rpc(undefined, init());
  assert.equal(none.status, 401);
  assert.match(none.headers.get("www-authenticate") ?? "", /Bearer/);
  const cookie = await rpc(undefined, init(), { cookie: alice.cookie });
  assert.equal(cookie.status, 401, "a session cookie does not grant access to MCP");
  const plain = await rpc(plainToken.token, init());
  assert.equal(plain.status, 403);
  assert.equal(plain.json.error, "mcp_not_allowed");
  const origin = await rpc(mcpToken.token, init(), { origin: "https://evil.example" });
  assert.equal(origin.status, 403);
  assert.equal(origin.json.error, "origin_not_allowed");
  const temp = await token({ name: "temp", mcp: true });
  const del = await api(base, "DELETE", `/api/v1/me/tokens/${temp.id}`, undefined, { cookie: alice.cookie });
  assert.equal(del.status, 204);
  const revoked = await rpc(temp.token, init());
  assert.equal(revoked.status, 401);
});

test("tools: search only finds active, reading the main file and a linked file; candidate and escaping the bounds — not found", async () => {
  const s = await callTool(mcpToken.token, "search_artifacts", { query: "pdf" });
  assert.ok(!s.isError, JSON.stringify(s));
  assert.deepEqual(s.structuredContent.items.map((i) => i.name), ["pdf-tools"]);
  assert.equal(s.content[0].type, "text");
  assert.deepEqual(JSON.parse(s.content[0].text), s.structuredContent);
  const all = await callTool(mcpToken.token, "search_artifacts", { type: "skill", limit: 50 });
  const allNames = all.structuredContent.items.map((i) => i.name).sort();
  assert.deepEqual(allNames, ["pdf-tools", "team-a-notes", "team-b-notes"], "candidate draft-notes is not visible");

  const g = await callTool(mcpToken.token, "get_artifact", { type: "skill", name: "pdf-tools" });
  assert.ok(!g.isError, JSON.stringify(g));
  const art = g.structuredContent;
  assert.equal(art.main_file.path, "skills/pdf-tools/SKILL.md");
  assert.equal(art.main_file.text, PDF_SKILL);
  assert.ok(art.files.some((f) => f.path === "skills/pdf-tools/references/REFERENCE.md" && f.size > 0));
  const f = await callTool(mcpToken.token, "read_artifact_file", { type: "skill", name: "pdf-tools", path: "skills/pdf-tools/references/REFERENCE.md" });
  assert.equal(f.structuredContent.text, PDF_REF);

  const cand = await callTool(mcpToken.token, "get_artifact", { type: "skill", name: "draft-notes" });
  assert.equal(cand.isError, true);
  assert.match(cand.content[0].text, /not found/i);
  for (const path of ["../../skillforge.db", "skills/pdf-tools/../SKILL.md", "/etc/passwd", "skills\\pdf-tools\\SKILL.md"]) {
    const r = await callTool(mcpToken.token, "read_artifact_file", { type: "skill", name: "pdf-tools", path });
    assert.equal(r.isError, true, `path ${path}`);
    assert.match(r.content[0].text, /not found/i);
  }
  const noVer = await callTool(mcpToken.token, "get_artifact", { type: "skill", name: "pdf-tools", version: "9.9.9" });
  assert.equal(noVer.isError, true);
});

test("consent tags narrow the scope: team-a only", async () => {
  const s = await callTool(tagToken.token, "search_artifacts", {});
  assert.deepEqual(s.structuredContent.items.map((i) => i.name), ["team-a-notes"]);
  const b = await callTool(tagToken.token, "get_artifact", { type: "skill", name: "team-b-notes" });
  assert.equal(b.isError, true);
  assert.match(b.content[0].text, /not found/i);
  const a = await callTool(tagToken.token, "get_artifact", { type: "skill", name: "team-a-notes" });
  assert.ok(!a.isError);
  assert.equal(a.structuredContent.main_file.text, skillMd("team-a-notes", "team-a"));
});

test("CLI skillforge mcp: stdio bridge, refusal without consent, exit codes without a token and without a URL", async () => {
  assert.ok(existsSync(CLI), "the CLI build is required");
  const lines = [
    JSON.stringify({ jsonrpc: "2.0", id: 101, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stdio", version: "1" } } }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({ jsonrpc: "2.0", id: 103, method: "tools/call", params: { name: "search_artifacts", arguments: { query: "pdf" } } }),
  ].join("\n") + "\n";
  const ok = await runCli(["mcp"], { env: { SKILLFORGE_URL: base, SKILLFORGE_TOKEN: mcpToken.token }, stdin: lines });
  assert.equal(ok.timedOut, false, "the bridge must exit on stdin EOF");
  assert.equal(ok.code, 0, ok.stderr);
  const out = ok.stdout.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(out.map((m) => m.id), [101, 103], `stdout contains only protocol responses: ${ok.stdout}`);
  assert.equal(out[0].result.serverInfo.name, "skillforge");
  assert.deepEqual(out[1].result.structuredContent.items.map((i) => i.name), ["pdf-tools"]);

  const denied = await runCli(["mcp"], { env: { SKILLFORGE_URL: base, SKILLFORGE_TOKEN: plainToken.token }, stdin: lines.split("\n")[0] + "\n" });
  assert.equal(denied.timedOut, false);
  const d = JSON.parse(denied.stdout.trim().split(/\r?\n/)[0]);
  assert.equal(d.id, 101);
  assert.equal(d.error.code, -32001);
  assert.match(d.error.message, /mcp_not_allowed/);

  const noToken = await runCli(["mcp"], { env: { SKILLFORGE_URL: base }, stdin: lines });
  assert.equal(noToken.code, 4, noToken.stderr);
  assert.equal(noToken.stdout, "");
  const noUrl = await runCli(["mcp"], { env: { SKILLFORGE_TOKEN: mcpToken.token }, stdin: lines });
  assert.equal(noUrl.code, 3, noUrl.stderr);
});

test("special body parsing only for /mcp: other routes still reject __proto__ in JSON", async () => {
  // Regression guard: raw body parsing for /mcp must not be done by replacing the JSON parser of the whole
  // application with JSON.parse — that would remove Fastify's prototype poisoning protection from all routes.
  const body = '{"name":"proto-probe","__proto__":{"mcp":true}}';
  const r = await fetch(`${base}/api/v1/me/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: alice.cookie },
    body,
  });
  assert.equal(r.status, 400, `a body with __proto__ must be rejected: ${r.status} ${await r.text()}`);
  const ctor = await fetch(`${base}/api/v1/me/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: alice.cookie },
    body: '{"name":"ctor-probe","constructor":{"prototype":{"mcp":true}}}',
  });
  assert.equal(ctor.status, 400, "constructor.prototype is also rejected");
  // For /mcp itself the raw text is still parsed as JSON-RPC.
  const ok = await rpc(mcpToken.token, req("ping"));
  assert.equal(ok.status, 200);
});
