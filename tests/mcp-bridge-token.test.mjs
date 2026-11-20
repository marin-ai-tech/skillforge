// Acceptance tests for mcp-bridge-token: the CLI keeps a separate MCP token (`mcp_token`) next to the regular one,
// `skillforge login --mcp-token-stdin` saves it after a check against /mcp, and the `skillforge mcp` bridge uses it,
// so the path a person follows — regular login, then the stdio bridge — works and `install`/`sync` keep working.
// Oracle: the server itself — an MCP token on the REST API gets 403 mcp_token_forbidden, a regular token on /mcp gets
// 403 mcp_not_allowed. Requires `npm run build`. Every CLI call has a kill timeout.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const PASSWORD = "bridge-token-pw-1";

let srv;
let base;
let alt; // the same server under another address: a different registry for the CLI
let admin;
let bob;
let work;
let mcpTok; // bob, mcp: true
let plainTok; // bob, no consent
const seen = []; // every token the CLI could print

const INIT = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "1" } } }) + "\n";

function runCli(args, { config, env = {}, stdin = "", timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: config, NO_COLOR: "1", SKILLFORGE_URL: undefined, SKILLFORGE_TOKEN: undefined, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(stdin);
  });
}

/** Asserts that no output of a CLI call contains a token. */
function noTokenIn(r, label) {
  for (const t of seen) {
    assert.ok(!r.stdout.includes(t) && !r.stderr.includes(t), `${label}: a token was printed`);
  }
}

const cfgPath = (name) => {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  return join(dir, "config.json");
};
const readCfg = (p) => JSON.parse(readFileSync(p, "utf8"));
const entryFor = (cfg, url) => Object.values(cfg.registries).find((e) => e.url === url);

async function passwordLogin(config, url = base, extra = []) {
  const r = await runCli(["login", "--url", url, "--username", "bob", "--password-stdin", ...extra], { config, stdin: `${PASSWORD}\n` });
  assert.equal(r.timedOut, false);
  assert.equal(r.code, 0, `password login: ${r.stderr}`);
  return r;
}

async function saveMcp(config, token, url = base, extra = []) {
  const r = await runCli(["login", "--url", url, "--mcp-token-stdin", ...extra], { config, stdin: `${token}\n` });
  assert.equal(r.timedOut, false, "login --mcp-token-stdin must exit");
  noTokenIn(r, "login --mcp-token-stdin");
  return r;
}

async function bridge(config, env = {}) {
  const r = await runCli(["mcp"], { config, env: { SKILLFORGE_URL: base, ...env }, stdin: INIT });
  assert.equal(r.timedOut, false, "the bridge must exit on stdin EOF");
  noTokenIn(r, "skillforge mcp");
  return r;
}
const firstLine = (r) => JSON.parse(r.stdout.trim().split(/\r?\n/)[0]);

before(async () => {
  assert.ok(existsSync(CLI), "the CLI build is required");
  srv = await startServer({}, { prefix: "skillforge-bridge-token-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  alt = base.replace("127.0.0.1", "localhost");
  assert.notEqual(alt, base);
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "bob", password: PASSWORD, role: "contributor" });
  bob = await login(base, "bob", PASSWORD);
  const mk = async (body) => {
    const r = await api(base, "POST", "/api/v1/me/tokens", body, { cookie: bob.cookie });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    seen.push(r.data.token);
    return r.data;
  };
  mcpTok = await mk({ name: "bridge-mcp", mcp: true });
  plainTok = await mk({ name: "bridge-plain" });
  // an active skill to install with the regular token
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, { cookie: admin.cookie });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const t = await api(base, "POST", "/api/v1/artifacts/skill/pdf-tools/transitions", { to: "active", reason: "bridge token test" }, { cookie: admin.cookie });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  work = mkdtempSync(join(tmpdir(), "skillforge-bridge-token-"));
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("regular login, then the MCP token from stdin: the bridge connects and install keeps the regular token", async () => {
  const config = cfgPath("person");
  await passwordLogin(config);
  const before = entryFor(readCfg(config), base);
  seen.push(before.token);

  const saved = await saveMcp(config, mcpTok.token);
  assert.equal(saved.code, 0, `save: ${saved.stderr}`);
  const after = entryFor(readCfg(config), base);
  assert.equal(after.token, before.token, "the regular token is untouched");
  assert.equal(after.mcp_token, mcpTok.token, "the MCP token is saved as mcp_token");

  const b = await bridge(config);
  assert.equal(b.code, 0, b.stderr);
  const m = firstLine(b);
  assert.equal(m.id, 1);
  assert.equal(m.error, undefined, `the bridge sent a token /mcp refuses: ${b.stdout}`);
  assert.equal(m.result.serverInfo.name, "skillforge");

  // negative: commands on the REST API never send the MCP token (it would get 403 mcp_token_forbidden)
  const who = await runCli(["whoami", "--url", base], { config });
  assert.equal(who.code, 0, who.stderr);
  assert.match(who.stdout, /bob/);
  noTokenIn(who, "whoami");
  const into = join(work, "person-install", ".claude");
  const inst = await runCli(["install", "skill/pdf-tools", "--into", into, "--url", base], { config });
  assert.equal(inst.code, 0, `install with mcp_token in the config: ${inst.stderr}`);
  assert.ok(existsSync(join(into, "skills", "pdf-tools", "SKILL.md")), "the skill is installed");
  noTokenIn(inst, "install");
});

test("a token without MCP consent is refused and the config stays byte for byte", async () => {
  const config = cfgPath("refuse");
  await passwordLogin(config);
  const bytes = readFileSync(config, "utf8");
  const r = await saveMcp(config, plainTok.token);
  assert.equal(r.code, 4, `exit code: ${r.stderr}`);
  assert.match(r.stderr, /mcp_not_allowed/);
  assert.match(r.stderr, /Allow agents to load active skills via MCP/);
  assert.equal(readFileSync(config, "utf8"), bytes, "the config is unchanged");
});

test("--mcp-token-stdin does not combine with --token or --password-stdin", async () => {
  const config = cfgPath("combine");
  const a = await runCli(["login", "--url", base, "--mcp-token-stdin", "--token", plainTok.token], { config, stdin: `${mcpTok.token}\n` });
  assert.equal(a.code, 1, a.stderr);
  const b = await runCli(["login", "--url", base, "--mcp-token-stdin", "--username", "bob", "--password-stdin"], { config, stdin: `${mcpTok.token}\n` });
  assert.equal(b.code, 1, b.stderr);
  assert.ok(!existsSync(config) || !entryFor(readCfg(config), base)?.mcp_token, "nothing saved");
});

test("a new login to the same address keeps mcp_token; another address under the same name drops it", async () => {
  const config = cfgPath("relogin");
  await passwordLogin(config, base, ["--name", "corp"]);
  assert.equal((await saveMcp(config, mcpTok.token, base, ["--name", "corp"])).code, 0);
  seen.push(readCfg(config).registries.corp.token);

  await passwordLogin(config, base, ["--name", "corp"]);
  assert.equal(readCfg(config).registries.corp.mcp_token, mcpTok.token, "same address: kept");
  seen.push(readCfg(config).registries.corp.token);

  await passwordLogin(config, alt, ["--name", "corp"]);
  const e = readCfg(config).registries.corp;
  assert.equal(e.url, alt);
  assert.equal(e.mcp_token, undefined, "another address: dropped");
  seen.push(e.token);
});

test("the MCP token alone, without a regular login: the bridge works", async () => {
  const config = cfgPath("mcp-only");
  const r = await saveMcp(config, mcpTok.token);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(entryFor(readCfg(config), base).mcp_token, mcpTok.token);
  const b = await bridge(config);
  assert.equal(b.code, 0, b.stderr);
  assert.equal(firstLine(b).result.serverInfo.name, "skillforge");
});

test("the bridge with only a regular token: mcp_not_allowed and a hint how to save the MCP token", async () => {
  const config = cfgPath("plain-only");
  await passwordLogin(config);
  seen.push(entryFor(readCfg(config), base).token);
  const b = await bridge(config);
  const m = firstLine(b);
  assert.equal(m.error.code, -32001);
  assert.match(m.error.message, /mcp_not_allowed/);
  assert.match(b.stderr, /--mcp-token-stdin/);
});

test("SKILLFORGE_TOKEN still wins; mcp_token never goes to another address", async () => {
  const config = cfgPath("order");
  await passwordLogin(config);
  seen.push(entryFor(readCfg(config), base).token);
  assert.equal((await saveMcp(config, mcpTok.token)).code, 0);
  // an explicit token in the environment wins over mcp_token: a regular one is refused
  const env = await bridge(config, { SKILLFORGE_TOKEN: plainTok.token });
  assert.match(firstLine(env).error.message, /mcp_not_allowed/);
  // another address has no entry: no token at all, exit 4 before reading stdin
  const other = await runCli(["mcp", "--url", alt], { config, stdin: INIT });
  assert.equal(other.code, 4, other.stderr);
  assert.equal(other.stdout, "");
});

test("logout removes the entry with mcp_token and does not revoke the MCP token", async () => {
  const config = cfgPath("logout");
  await passwordLogin(config);
  seen.push(entryFor(readCfg(config), base).token);
  assert.equal((await saveMcp(config, mcpTok.token)).code, 0);
  const r = await runCli(["logout"], { config }); // logout acts on the default entry
  assert.equal(r.code, 0, r.stderr);
  noTokenIn(r, "logout");
  assert.equal(entryFor(readCfg(config), base), undefined, "the entry is gone");
  assert.match(`${r.stdout}${r.stderr}`, /API tokens/);
  const still = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${mcpTok.token}` },
    body: INIT,
  });
  assert.equal(still.status, 200, "the MCP token was not revoked");
});
