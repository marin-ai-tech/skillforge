// Acceptance tests for the MCP shadow inventory. The CLI runs with a substituted home directory against a real server through a proxy
// that records request bodies: it checks both what went over the network and what ended up in the server data files.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, ADMIN_PASSWORD, ROOT } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const KILL_MS = 30_000;
const SKILL = "---\nname: local-notes\ndescription: Keeps short project notes and reminders. Use when the user asks to remember or recall a note.\n---\n\n# Local notes\n\nStore notes in `notes.md`.\n";

let srv;
let proxy;
let proxyBase;
let work;
let home;
let proj;
let adminCookie;
let aliceToken;
let bobToken;
let ritaCookie;
const seen = [];

function cli(args, { cwd = proj, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CLAUDE_CONFIG_DIR: undefined,
        CODEX_HOME: undefined,
        SKILLFORGE_CONFIG: join(work, "config.json"),
        SKILLFORGE_URL: proxyBase,
        SKILLFORGE_TOKEN: aliceToken,
        NO_COLOR: "1",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), KILL_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

const obs = (o) => ({
  scope: "user",
  transport: "stdio",
  launcher: "npx",
  package: null,
  pinned: false,
  version: null,
  origin: null,
  env: [],
  headers: [],
  literal_secret: false,
  enabled: true,
  runtime: "claude-code",
  source: "~/.claude.json",
  ...o,
});

const mcpBody = (servers) => ({
  sources: [{ runtime: "claude-code", scope: "user", path: "~/.claude.json", found: true }],
  servers,
  issues: [],
});

const putAgent = (token, name, extra) =>
  api(proxyBase, "PUT", `/api/v1/me/agents/${name}`, { runtime: "claude-code", files: [{ path: "skills/local-notes/SKILL.md", content_base64: Buffer.from(SKILL).toString("base64") }], ...extra }, { token });

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-mcp-inv-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  proxy = createServer((req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, body: body.toString("utf8") });
      const up = new URL(srv.base);
      const fwd = httpRequest({ host: up.hostname, port: up.port, method: req.method, path: req.url, headers: { ...req.headers, host: up.host } }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      fwd.end(body);
    });
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  proxyBase = `http://127.0.0.1:${proxy.address().port}`;

  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  adminCookie = admin.cookie;
  for (const [username, role] of [["alice", "contributor"], ["bob", "contributor"], ["rita", "reviewer"]]) {
    await createUser(srv.base, adminCookie, { username, password: `${username}-pw-1`, role });
  }
  const tok = async (u) => {
    const s = await login(srv.base, u, `${u}-pw-1`);
    return (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: s.cookie })).data.token;
  };
  aliceToken = await tok("alice");
  bobToken = await tok("bob");
  ritaCookie = (await login(srv.base, "rita", "rita-pw-1")).cookie;

  work = mkdtempSync(join(tmpdir(), "skillforge-mcp-inv-work-"));
  home = join(work, "home-alice");
  proj = join(work, "proj");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(proj, ".claude", "skills", "local-notes"), { recursive: true });
  writeFileSync(join(proj, ".claude", "skills", "local-notes", "SKILL.md"), SKILL);
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      history: [{ display: "FAKE-SECRET-history-0001" }],
      mcpServers: { tickets: { command: "npx", args: ["-y", "tickets-mcp"], env: { TICKETS_API_KEY: "FAKE-SECRET-home-0002" } } },
      projects: { [join(work, "FAKE-SECRET-path-0003")]: { mcpServers: {} } },
    }),
  );
  writeFileSync(
    join(proj, ".mcp.json"),
    JSON.stringify({ mcpServers: { github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" } } } }),
  );
  mkdirSync(join(proj, ".gemini", "skills", "local-notes"), { recursive: true });
  writeFileSync(join(proj, ".gemini", "skills", "local-notes", "SKILL.md"), SKILL);
});

after(async () => {
  if (proxy) await new Promise((r) => proxy.close(r));
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

const lastPut = () => seen.filter((r) => r.method === "PUT").at(-1);

test("agent scan --mcp: a literal key stays on the machine, observations are saved", async () => {
  seen.length = 0;
  const r = await cli(["agent", "scan", ".claude", "--name", "laptop", "--mcp"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /mcp: 2 server\(s\), 1 unpinned, 1 with literal secrets/);
  assert.match(r.stdout, /literal secret: TICKETS_API_KEY/);
  assert.ok(!(r.stdout + r.stderr).includes("FAKE-SECRET-"), r.stdout);
  const body = lastPut().body;
  assert.ok(!body.includes("FAKE-SECRET-"), "the request body contains a value from the config");
  assert.ok(!body.includes(home.replace(/\\/g, "\\\\")) && !body.includes(work.replace(/\\/g, "\\\\")), "the body contains an absolute path");
  const sent = JSON.parse(body).mcp;
  assert.deepEqual(sent.servers.map((s) => `${s.name}|${s.scope}|${s.source}`).sort(), ["github|project|.mcp.json", "tickets|user|~/.claude.json"]);

  const got = await api(srv.base, "GET", "/api/v1/me/agents/laptop", undefined, { token: aliceToken });
  assert.equal(got.status, 200);
  assert.ok(got.data.mcp_scanned_at);
  assert.deepEqual(got.data.mcp_servers.map((s) => s.name), ["github", "tickets"]);
  const tickets = got.data.mcp_servers.find((s) => s.name === "tickets");
  assert.deepEqual([tickets.package, tickets.pinned, tickets.literal_secret], ["tickets-mcp", false, true]);
  assert.deepEqual(tickets.env, [{ name: "TICKETS_API_KEY", kind: "literal", secret_like: true }]);

  for (const f of filesUnder(srv.dataDir)) {
    assert.ok(!readFileSync(f).includes("FAKE-SECRET-"), `server data (${f}) contains a value from the config`);
  }
});

test("without --mcp configs are not read and earlier observations are not erased", async () => {
  seen.length = 0;
  const r = await cli(["agent", "scan", ".claude", "--name", "laptop"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(!("mcp" in JSON.parse(lastPut().body)), "the mcp field was sent without consent");
  const got = await api(srv.base, "GET", "/api/v1/me/agents/laptop", undefined, { token: aliceToken });
  assert.equal(got.data.mcp_servers.length, 2);
});

test("runtime without MCP sources: exit code 1, the server is not contacted", async () => {
  seen.length = 0;
  const r = await cli(["agent", "scan", ".gemini", "--runtime", "gemini", "--name", "g", "--mcp"]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.equal(seen.length, 0);
});

test("admin summary: identity, attention order, totals; reviewer gets 403", async () => {
  const bob = await putAgent(bobToken, "bob-laptop", {
    mcp: mcpBody([
      obs({ name: "tix", package: "tickets-mcp", pinned: true, version: "1.2.3", env: [{ name: "TICKETS_API_KEY", kind: "reference", secret_like: true }] }),
      obs({ name: "sentry", transport: "http", launcher: null, origin: "https://mcp.sentry.dev", headers: [{ name: "Authorization", kind: "reference", secret_like: true }] }),
    ]),
  });
  assert.equal(bob.status, 200, JSON.stringify(bob.data));
  assert.deepEqual(bob.data.mcp, { servers: 2, unpinned: 0, literal_secret: 0 });

  const inv = await api(srv.base, "GET", "/api/v1/admin/inventory", undefined, { cookie: adminCookie });
  assert.equal(inv.status, 200);
  const m = inv.data.mcp;
  assert.deepEqual(m.totals, { agents: 2, people: 2, servers: 3, installs: 4, unpinned_installs: 1, literal_secret_installs: 1, remote_installs: 1 });
  assert.deepEqual(m.servers.map((s) => s.key), ["package:npx:tickets-mcp", "package:npx:@modelcontextprotocol/server-github", "origin:https://mcp.sentry.dev"]);
  const t = m.servers[0];
  assert.deepEqual(
    { kind: t.kind, label: t.label, names: t.names, installs: t.installs, people: t.people, versions: t.versions, unpinned: t.unpinned_installs, literal: t.literal_secret_installs },
    { kind: "package", label: "tickets-mcp", names: ["tickets", "tix"], installs: 2, people: ["alice", "bob"], versions: ["1.2.3"], unpinned: 1, literal: 1 },
  );
  assert.equal(m.servers[2].unpinned_installs, 0);
  assert.ok(!JSON.stringify(m).includes("FAKE-SECRET-"));

  const denied = await api(srv.base, "GET", "/api/v1/admin/inventory", undefined, { cookie: ritaCookie });
  assert.equal(denied.status, 403);
});

test("strict schema: an extra field, an origin with a path and a foreign path template give 400, the snapshot is unchanged", async () => {
  const bad = [
    mcpBody([obs({ name: "x", value: "FAKE-SECRET-forged-0004" })]),
    mcpBody([obs({ name: "x", args: ["--token", "FAKE-SECRET-forged-0005"] })]),
    mcpBody([obs({ name: "x", transport: "http", launcher: null, origin: "https://h.example/s/abc" })]),
    mcpBody([obs({ name: "x", source: "/home/alice/.claude.json" })]),
    { ...mcpBody([]), extra: true },
    mcpBody([obs({ name: "x", env: [{ name: "K", kind: "literal", secret_like: true, value: "FAKE-SECRET-forged-0006" }] })]),
  ];
  for (const mcp of bad) {
    const r = await putAgent(bobToken, "bob-laptop", { mcp });
    assert.equal(r.status, 400, JSON.stringify(mcp));
  }
  const got = await api(srv.base, "GET", "/api/v1/me/agents/bob-laptop", undefined, { token: bobToken });
  assert.deepEqual(got.data.mcp_servers.map((s) => s.name).sort(), ["sentry", "tix"]);
});

test("an empty list replaces observations; another user's agent gives 404", async () => {
  const before = (await api(srv.base, "GET", "/api/v1/me/agents/bob-laptop", undefined, { token: bobToken })).data.mcp_scanned_at;
  await new Promise((r) => setTimeout(r, 5));
  const r = await putAgent(bobToken, "bob-laptop", { mcp: mcpBody([]) });
  assert.equal(r.status, 200);
  const got = await api(srv.base, "GET", "/api/v1/me/agents/bob-laptop", undefined, { token: bobToken });
  assert.deepEqual(got.data.mcp_servers, []);
  assert.notEqual(got.data.mcp_scanned_at, before);
  const foreign = await api(srv.base, "GET", "/api/v1/me/agents/laptop", undefined, { token: bobToken });
  assert.equal(foreign.status, 404);
});
