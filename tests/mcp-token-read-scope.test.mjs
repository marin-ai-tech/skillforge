// An MCP token over REST sees no more than over MCP: all of `/api/*` is closed except `GET /api/v1/me` and
// `GET /api/v1/health`. Requires a build.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let base;
let admin;
let viewer;
let work;

const skill = (name, tag) => [
  {
    path: "SKILL.md",
    content_base64: Buffer.from(
      `---\nname: ${name}\ndescription: Skill ${name} for MCP read scope checks. Use when the user asks for ${name}.\ntags: [${tag}]\n---\n\n# ${name}\n\nBody.\n`,
    ).toString("base64"),
  },
];

async function token(cookie, body) {
  const r = await api(base, "POST", "/api/v1/me/tokens", body, { cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.token;
}
async function mcpCall(tok, method, params) {
  const r = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(r.status, 200);
  return (await r.json()).result;
}
function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: undefined, SKILLFORGE_TOKEN: undefined, ...env },
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
  srv = await startServer({}, { prefix: "skillforge-mcpread-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "vera", password: "vera-pw-12", role: "viewer" });
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  viewer = await login(base, "vera", "vera-pw-12");
  const alice = await login(base, "alice", "alice-pw-1");
  for (const [name, tag] of [["draft-one", "team-a"], ["other-active", "team-b"], ["team-a-active", "team-a"]]) {
    const p = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: skill(name, tag) }, { cookie: alice.cookie });
    assert.equal(p.status, 201, JSON.stringify(p.data));
  }
  for (const name of ["other-active", "team-a-active"]) {
    const t = await api(base, "POST", `/api/v1/artifacts/skill/${name}/transitions`, { to: "active" }, { cookie: admin.cookie });
    assert.equal(t.status, 200, JSON.stringify(t.data));
  }
  work = mkdtempSync(join(tmpdir(), "skillforge-mcpread-work-"));
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("reads beyond consent are closed: list, candidate card, audit, version archive outside tags", async () => {
  const tok = await token(admin.cookie, { name: "agent-a", mcp: true, mcp_tags: ["team-a"] });
  for (const path of [
    "/api/v1/artifacts",
    "/api/v1/artifacts/skill/draft-one",
    "/api/v1/artifacts/skill/draft-one/audit",
    "/api/v1/artifacts/skill/other-active/versions/0.1.0",
    "/api/v1/artifacts/skill/other-active/versions/0.1.0/bundle.zip",
    "/api/v1/me/tokens",
    "/api/v1/metrics/overview",
  ]) {
    const r = await api(base, "GET", path, undefined, { token: tok });
    assert.equal(r.status, 403, `${path}: ${r.status}`);
    assert.equal(r.data?.error, "mcp_token_forbidden", path);
  }
  const found = await mcpCall(tok, "tools/call", { name: "search_artifacts", arguments: {} });
  const names = found.structuredContent.items.map((i) => i.name);
  assert.deepEqual(names, ["team-a-active"]);
});

test("exceptions: /me and /health (no data_dir even for admin); CLI login --token and whoami", async () => {
  const tok = await token(admin.cookie, { name: "agent-admin", mcp: true });
  const me = await api(base, "GET", "/api/v1/me", undefined, { token: tok });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, "admin");
  const health = await api(base, "GET", "/api/v1/health", undefined, { token: tok });
  assert.equal(health.status, 200);
  assert.equal("data_dir" in health.data, false, "the admin MCP token sees the path");

  const vtok = await token(viewer.cookie, { name: "agent-viewer", mcp: true });
  const loginCli = await runCli(["login", "--url", base, "--token", vtok]);
  assert.equal(loginCli.code, 0, loginCli.stderr);
  const who = await runCli(["whoami"]);
  assert.equal(who.code, 0, who.stderr);
  assert.match(who.stdout, /vera/);
});

test("MCP works: record_usage for an active skill", async () => {
  const tok = await token(viewer.cookie, { name: "agent-usage", mcp: true });
  const res = await mcpCall(tok, "tools/call", { name: "record_usage", arguments: { type: "skill", name: "other-active", uses: 1, helped: 1 } });
  assert.notEqual(res.isError, true, JSON.stringify(res));
});
