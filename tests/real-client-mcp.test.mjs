// The connection commands from `packages/web/src/lib/mcp-connect.ts` (exactly the lines the user sees on /me/tokens) are run by real
// clients in isolated home directories against a dedicated SkillForge server:
//   OpenCode, Qwen Code — `mcp list` shows the server as connected (HTTP and stdio in separate sandboxes: one name); the HTTP
//   snippet names SKILLFORGE_MCP_TOKEN, and no client config file keeps the token (fix-mcp-client-snippets);
//   Codex — `mcp add` writes the expected config.toml (Codex does not check the connection without a model).
// stdio bridge: `skillforge` is an npm-like `.cmd` wrapper on the sandbox PATH plus the CLI configuration in its home directory,
// prepared the way a person does it (mcp-bridge-token): a regular token as the login, the MCP token saved with
// `skillforge login --mcp-token-stdin` — never the MCP token in place of the regular one, a state login does not create.
// (clients pass a trimmed environment to the MCP process). Negative case: a revoked token — HTTP is not connected.
// Binary: SKILLFORGE_<CLIENT>_BIN or an npm wrapper `<client>.cmd` on PATH; if absent, the test is skipped with a reason. Every test has a kill timeout.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parse as tomlParse } from "smol-toml";
import { startServer, api, login, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";
import { mcpConnectSnippets } from "../packages/web/src/lib/mcp-connect.ts";

/** smol-toml returns null-prototype objects; deepStrictEqual compares prototypes. */
const parseToml = (text) => JSON.parse(JSON.stringify(tomlParse(text)));

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const CALL_TIMEOUT_MS = 120_000;
let srv;
let base;
let admin;
let work;
let shimDir;

function shimTarget(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const shim = join(dir, `${name}.cmd`);
    if (!existsSync(shim)) continue;
    for (const m of readFileSync(shim, "utf8").matchAll(/"%dp0%\\([^"]+\.(?:js|exe))"/g)) {
      const target = join(dir, m[1]);
      if (!/^node\.exe$/i.test(m[1]) && existsSync(target)) return target;
    }
  }
  return null;
}

function findClient(name) {
  const target = process.env[`SKILLFORGE_${name.toUpperCase()}_BIN`] ?? shimTarget(name);
  if (!target || !existsSync(target)) return null;
  return target.endsWith(".js") ? { cmd: process.execPath, pre: [target] } : { cmd: target, pre: [] };
}

const CLIENTS = { codex: findClient("codex"), opencode: findClient("opencode"), qwen: findClient("qwen") };

/** Splits a shell command line with "double-quoted" arguments (the module rejects quotes inside values). */
function argv(line) {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

function sandbox(name, token) {
  const root = join(work, name);
  const home = join(root, "home");
  const proj = join(root, "proj");
  mkdirSync(join(home, ".skillforge"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true }); // Codex requires an existing CODEX_HOME
  mkdirSync(proj, { recursive: true });
  writeFileSync(
    join(home, ".skillforge", "config.json"),
    JSON.stringify({ registries: { local: { url: base, token } }, default: "local" }),
  );
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: join(home, ".codex"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    QWEN_HOME: join(home, ".qwen"),
    PATH: `${shimDir}${delimiter}${process.env.PATH}`,
    SKILLFORGE_TOKEN: undefined,
    SKILLFORGE_MCP_TOKEN: undefined,
    SKILLFORGE_URL: undefined,
    SKILLFORGE_CONFIG: undefined,
    NO_COLOR: "1",
  };
  return { home, proj, env };
}

function runSnippet(client, line, ctx) {
  const [program, ...args] = argv(line);
  assert.equal(program, client, line);
  return runClient(client, args, ctx);
}

function runClient(client, args, ctx) {
  const c = CLIENTS[client];
  const r = spawnSync(c.cmd, [...c.pre, ...args], {
    cwd: ctx.proj,
    env: ctx.env,
    encoding: "utf8",
    timeout: CALL_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // eslint-disable-next-line no-control-regex
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { code: r.status, out, error: r.error };
}

async function mcpToken(name) {
  const r = await api(base, "POST", "/api/v1/me/tokens", { name, mcp: true }, { cookie: admin.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

async function regularToken(name) {
  const r = await api(base, "POST", "/api/v1/me/tokens", { name }, { cookie: admin.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

/** A stdio sandbox as a person leaves it: a regular login, then the MCP token saved from stdin. */
async function stdioSandbox(name, mcpTok) {
  const ctx = sandbox(name, (await regularToken(`${name}-login`)).token);
  const r = spawnSync(process.execPath, [CLI, "login", "--url", base, "--mcp-token-stdin"], {
    env: { ...ctx.env, SKILLFORGE_CONFIG: join(ctx.home, ".skillforge", "config.json") },
    input: `${mcpTok}\n`,
    encoding: "utf8",
    timeout: CALL_TIMEOUT_MS,
  });
  assert.equal(r.status, 0, `login --mcp-token-stdin: ${r.stderr}`);
  return ctx;
}

async function revoke(id) {
  const r = await api(base, "DELETE", `/api/v1/me/tokens/${id}`, undefined, { cookie: admin.cookie });
  assert.ok(r.status === 204 || r.status === 200, `revoke: ${r.status}`);
}

const connected = (out) => /✓\s*skillforge\b[^\n]*connected/i.test(out) && !/✗\s*skillforge\b/.test(out);

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-real-mcp-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  work = mkdtempSync(join(tmpdir(), "skillforge-real-mcp-"));
  shimDir = join(work, "bin");
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(join(shimDir, "skillforge.cmd"), `@"${process.execPath}" "${CLI}" %*\r\n`);
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

/** The client config files an HTTP snippet may write (OpenCode: global and project; Qwen: user settings). */
function configFiles(client, ctx) {
  const files =
    client === "opencode"
      ? [
          join(ctx.home, ".config", "opencode", "opencode.jsonc"),
          join(ctx.home, ".config", "opencode", "opencode.json"),
          join(ctx.proj, "opencode.json"),
          join(ctx.proj, "opencode.jsonc"),
        ]
      : [join(ctx.home, ".qwen", "settings.json")];
  return files.filter((f) => existsSync(f));
}

/**
 * Applies the HTTP snippet as a person does: OpenCode runs the command; Qwen merges the block into ~/.qwen/settings.json
 * (a command line would not do: bash and PowerShell expand $VAR before Qwen saves it).
 */
function applyHttp(client, http, ctx) {
  if (client === "opencode") return runSnippet(client, http, ctx);
  const file = join(ctx.home, ".qwen", "settings.json");
  mkdirSync(join(ctx.home, ".qwen"), { recursive: true }); // a first-time user has no ~/.qwen yet
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  settings.mcpServers = { ...settings.mcpServers, ...JSON.parse(http).mcpServers };
  writeFileSync(file, JSON.stringify(settings, null, 2));
  return { code: 0, out: "" };
}

/** The former HTTP snippets (before fix-mcp-client-snippets) that kept the token in the client config. */
const OLD_HTTP = {
  opencode: (url, token) => ["mcp", "add", "skillforge", "--url", url, "--header", `Authorization=Bearer ${token}`],
  qwen: (url, token) => ["mcp", "add", "-s", "user", "-t", "http", "-H", `Authorization: Bearer ${token}`, "skillforge", url],
};
/** How the notes say to drop the old entry: OpenCode replaces it on the next add, Qwen removes it first. */
const DROP_OLD = { opencode: null, qwen: ["mcp", "remove", "-s", "user", "skillforge"] };

for (const client of ["opencode", "qwen"]) {
  // fix-mcp-client-snippets (#193): the HTTP snippet names SKILLFORGE_MCP_TOKEN; the client expands it at start, so the
  // token is in no config file. Negative: without the variable, and with a revoked token, it is not connected.
  test(`${client}: the HTTP snippet connects through SKILLFORGE_MCP_TOKEN; no config file keeps the token`, { skip: CLIENTS[client] ? false : `${client} not found` }, async () => {
    const tok = await mcpToken(`${client}-http`);
    const ctx = sandbox(`${client}-http`, tok.token);
    const add = applyHttp(client, mcpConnectSnippets(client, { baseUrl: base, token: tok.token }).http, ctx);
    assert.equal(add.code, 0, add.out);
    const files = configFiles(client, ctx);
    assert.ok(files.length > 0, `${client}: the snippet wrote no config file`);
    for (const f of files) assert.ok(!readFileSync(f, "utf8").includes(tok.token), `${client}: the token is in ${f}`);
    const withVar = { ...ctx, env: { ...ctx.env, SKILLFORGE_MCP_TOKEN: tok.token } };
    const list = runClient(client, ["mcp", "list"], withVar);
    assert.ok(connected(list.out), `${client} HTTP not connected with the variable:\n${list.out}`);
    const noVar = runClient(client, ["mcp", "list"], ctx);
    assert.ok(!connected(noVar.out), `${client}: connected without SKILLFORGE_MCP_TOKEN:\n${noVar.out}`);
    await revoke(tok.id);
    const again = runClient(client, ["mcp", "list"], withVar);
    assert.ok(!connected(again.out), `${client}: connected with a revoked token:\n${again.out}`);
  });

  test(`${client}: an entry made by the former snippet loses the token when the notes are followed`, { skip: CLIENTS[client] ? false : `${client} not found` }, async () => {
    const tok = await mcpToken(`${client}-old`);
    const ctx = sandbox(`${client}-old`, tok.token);
    const old = runClient(client, OLD_HTTP[client](`${base}/mcp`, tok.token), ctx);
    assert.equal(old.code, 0, old.out);
    assert.ok(configFiles(client, ctx).some((f) => readFileSync(f, "utf8").includes(tok.token)), "the former snippet kept the token");
    if (DROP_OLD[client]) assert.equal(runClient(client, DROP_OLD[client], ctx).code, 0);
    const add = applyHttp(client, mcpConnectSnippets(client, { baseUrl: base, token: tok.token }).http, ctx);
    assert.equal(add.code, 0, add.out);
    for (const f of configFiles(client, ctx)) assert.ok(!readFileSync(f, "utf8").includes(tok.token), `${client}: the token is still in ${f}`);
    const list = runClient(client, ["mcp", "list"], { ...ctx, env: { ...ctx.env, SKILLFORGE_MCP_TOKEN: tok.token } });
    assert.ok(connected(list.out), `${client} not connected after the replacement:\n${list.out}`);
  });

  test(`${client}: the stdio command (skillforge mcp) connects`, { skip: CLIENTS[client] ? false : `${client} not found` }, async () => {
    const tok = await mcpToken(`${client}-stdio`);
    const ctx = await stdioSandbox(`${client}-stdio`, tok.token);
    const add = runSnippet(client, mcpConnectSnippets(client, { baseUrl: base, token: tok.token }).stdio, ctx);
    assert.equal(add.code, 0, add.out);
    const list = runClient(client, ["mcp", "list"], ctx);
    assert.ok(connected(list.out), `${client} stdio not connected:\n${list.out}`);
  });
}

test("codex: the HTTP and stdio commands write the expected config.toml", { skip: CLIENTS.codex ? false : "codex not found" }, async () => {
  const tok = await mcpToken("codex");
  const s = mcpConnectSnippets("codex", { baseUrl: base, token: tok.token });
  const http = sandbox("codex-http", tok.token);
  assert.equal(runSnippet("codex", s.http, http).code, 0);
  const h = parseToml(readFileSync(join(http.home, ".codex", "config.toml"), "utf8"));
  assert.deepEqual(h.mcp_servers.skillforge, { url: `${base}/mcp`, bearer_token_env_var: "SKILLFORGE_MCP_TOKEN" });
  assert.ok(!readFileSync(join(http.home, ".codex", "config.toml"), "utf8").includes(tok.token), "the token is not written to config.toml");

  const stdio = await stdioSandbox("codex-stdio", tok.token);
  assert.equal(runSnippet("codex", s.stdio, stdio).code, 0);
  const st = parseToml(readFileSync(join(stdio.home, ".codex", "config.toml"), "utf8"));
  assert.equal(st.mcp_servers.skillforge.command, "skillforge");
  assert.deepEqual(st.mcp_servers.skillforge.args, ["mcp"]);
  assert.deepEqual(st.mcp_servers.skillforge.env, { SKILLFORGE_URL: base });
});
