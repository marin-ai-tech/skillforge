// fix-stdin-bom (#215): Windows PowerShell 5.1 puts one or two BOMs (U+FEFF) at the start of what it pipes into a
// program. No stdin reader of the CLI may take them as part of a password, a token or a JSON-RPC line.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const BOM = String.fromCharCode(0xfeff);
const PASSWORD = "lena-pw-123456";
const SPACED = " sam pw 123456 ";
let srv;
let work;
let mcpToken;

/** Runs the CLI with `input` on stdin; kill-timeout so a reader that waits forever fails instead of hanging. */
function cli(args, input, extraEnv = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, SKILLFORGE_CONFIG: join(work, `${Math.random().toString(36).slice(2)}.json`), NO_COLOR: "1" };
    delete env.SKILLFORGE_TOKEN;
    delete env.SKILLFORGE_URL;
    Object.assign(env, extraEnv);
    const child = spawn(process.execPath, [CLI, ...args], { env, cwd: work });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, config: env.SKILLFORGE_CONFIG });
    });
    child.stdin.end(input);
  });
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-stdin-bom-" });
  assert.ok(srv.up, srv.stderr);
  const admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  await createUser(srv.base, admin.cookie, { username: "lena", password: PASSWORD, role: "contributor" });
  await createUser(srv.base, admin.cookie, { username: "sam", password: SPACED, role: "contributor" });
  const t = await api(srv.base, "POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, { cookie: admin.cookie });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  mcpToken = t.data.token;
  work = mkdtempSync(join(tmpdir(), "skillforge-stdin-bom-"));
});
after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

const passwordLogin = (username, input) => cli(["login", "--url", srv.base, "--username", username, "--password-stdin"], input);

for (const [label, prefix] of [["one BOM", BOM], ["two BOMs (PowerShell 5.1 with $OutputEncoding = UTF8)", BOM + BOM]]) {
  test(`login --password-stdin with ${label} and CRLF signs in`, async () => {
    const r = await passwordLogin("lena", `${prefix}${PASSWORD}\r\n`);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /invalid_credentials/);
  });
}

test("negative case: the password is not trimmed - spaces are part of it, a BOM in the middle stays", async () => {
  assert.equal((await passwordLogin("sam", `${BOM}${SPACED}\n`)).status, 0, "a password with spaces after a BOM signs in");
  const trimmed = await passwordLogin("sam", `${SPACED.trim()}\n`);
  assert.notEqual(trimmed.status, 0, "the same password without its spaces must not sign in");
  const middle = await passwordLogin("lena", `lena-pw-${BOM}123456\n`);
  assert.notEqual(middle.status, 0, "a BOM inside the password is part of it");
});

test("login --mcp-token-stdin with BOMs saves the token without them", async () => {
  const r = await cli(["login", "--url", srv.base, "--mcp-token-stdin"], `${BOM}${BOM}${mcpToken}\r\n`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const saved = readFileSync(r.config, "utf8");
  assert.ok(saved.includes(JSON.stringify(mcpToken)), "the token is saved as is");
  assert.ok(!saved.includes(BOM) && !saved.includes("\\ufeff"), "no BOM in the saved config");
});

test("the skillforge mcp bridge answers a first line that starts with BOMs as a normal initialize", async () => {
  const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bom-probe", version: "1" } } });
  const r = await cli(["mcp"], `${BOM}${BOM}${init}\n`, { SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: mcpToken });
  assert.equal(r.status, 0, r.stderr);
  const first = JSON.parse(r.stdout.split("\n")[0]);
  assert.equal(first.id, 1, r.stdout);
  assert.ok(first.result?.serverInfo, `initialize answered with a result: ${r.stdout}`);
});

test("audit 8b: every CLI file that reads process.stdin passes it through stripBom", async () => {
  const { readdirSync } = await import("node:fs");
  const src = join(ROOT, "packages", "cli", "src");
  const files = readdirSync(src, { recursive: true }).filter((f) => String(f).endsWith(".ts")).map((f) => join(src, String(f)));
  const readers = files.filter((f) => /process\.stdin\b/.test(readFileSync(f, "utf8")));
  assert.ok(readers.length >= 2, `found the stdin readers: ${readers.join(", ")}`);
  const missing = readers.filter((f) => !/\bstripBom\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(missing, [], "a new stdin reader must strip the BOM PowerShell 5.1 adds");
});
