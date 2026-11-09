// Acceptance tests for the CLI command `skillforge metrics`. Requires `npm run build`.
// Exit codes follow the existing CLI contract: 0 success, 1 server validation error, 2 local flag error/conflict,
// 3 registry not set, 4 not signed in / no permission, 6 not found.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let work;
const T = {};
const C = {};

const cli = (args, who, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: who ? T[who] : "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 60000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
const rest = (method, path, body, who) => api(srv.base, method, path, body, { cookie: C[who].cookie });

const skillFiles = loadDir(join(FIXTURES, "skill-standard"));
const files = (name) =>
  skillFiles.map((f) => ({
    path: f.path.replace("pdf-tools", name),
    content: f.path.endsWith("SKILL.md") ? Buffer.from(f.content.toString("utf8").replace(/^name: pdf-tools$/m, `name: ${name}`)) : f.content,
  }));

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI} — run npm run build`);
  srv = await startServer({}, { prefix: "skillforge-metrics-cli-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  C.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["rita", "reviewer"]]) {
    await createUser(srv.base, C.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    C[u] = await login(srv.base, u, `${u}-pw-123`);
    T[u] = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: C[u].cookie })).data.token;
  }
  work = mkdtempSync(join(tmpdir(), "skillforge-metrics-cli-work-"));
  for (const [n, uses, helped] of [["mcli-hi", 10, 9], ["mcli-mid", 10, 5], ["mcli-low", 10, 1]]) {
    const r = await rest("POST", "/api/v1/artifacts", { type: "skill", files: toB64(files(n)) }, "alice");
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal((await rest("POST", `/api/v1/artifacts/skill/${n}/transitions`, { to: "active", reason: "go" }, "rita")).status, 200);
    assert.equal((await rest("POST", `/api/v1/artifacts/skill/${n}/usage`, { uses, helped }, "alice")).status, 201);
  }
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("metrics --json: board, filters, sorting, pagination", async () => {
  const r = await cli(["metrics", "--q", "mcli-", "--sort", "transfer_rate", "--order", "desc", "--json"], "alice");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const data = JSON.parse(r.stdout);
  assert.deepEqual(data.items.map((i) => i.name), ["mcli-hi", "mcli-mid", "mcli-low"]);
  assert.equal(data.totals.artifacts, 3);
  assert.equal(data.totals.transfer_rate, 0.5);
  const asc = JSON.parse((await cli(["metrics", "--q", "mcli-", "--sort", "transfer_rate", "--order", "asc", "--limit", "2", "--json"], "alice")).stdout);
  assert.deepEqual(asc.items.map((i) => i.name), ["mcli-low", "mcli-mid"]);
  assert.equal(asc.next_offset, 2);
  const filtered = JSON.parse((await cli(["metrics", "--q", "mcli-", "--type", "command", "--json"], "alice")).stdout);
  assert.deepEqual(filtered.items, []);
  // public read: the board is available without signing in
  const anon = await cli(["metrics", "--q", "mcli-", "--json"], undefined);
  assert.equal(anon.code, 0, anon.stdout + anon.stderr);
  // human-readable table
  const human = await cli(["metrics", "--q", "mcli-"], "alice");
  assert.equal(human.code, 0, human.stdout + human.stderr);
  for (const n of ["mcli-hi", "mcli-mid", "mcli-low"]) assert.ok(human.stdout.includes(n), human.stdout);
  assert.ok(/transfer/i.test(human.stdout), "the table has a Transfer Rate column");
});

test("metrics --csv: server export, signed-in users only; incompatible flags", async () => {
  const r = await cli(["metrics", "--q", "mcli-", "--sort", "name", "--order", "asc", "--csv"], "alice");
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 4, "header + 3 rows");
  assert.ok(lines[0].includes("transfer_rate") && lines[0].includes("token_efficiency"), lines[0]);
  assert.ok(lines[1].includes("mcli-hi"));
  assert.equal((await cli(["metrics", "--csv"], undefined)).code, 4, "the export requires signing in");
  const both = await cli(["metrics", "--csv", "--json"], "alice");
  assert.ok([1, 2].includes(both.code), `--csv and --json together -> ${both.code}`);
});

test("metrics: invalid parameters and registry not set", async () => {
  for (const args of [["--sort", "owner"], ["--limit", "0"], ["--limit", "201"], ["--status", "ghost"], ["--order", "up"]]) {
    const r = await cli(["metrics", ...args, "--json"], "alice");
    assert.ok([1, 2].includes(r.code), `${args.join(" ")} -> ${r.code}: ${r.stdout}${r.stderr}`);
  }
  const none = await cli(["metrics", "--json"], "alice", { SKILLFORGE_URL: "", SKILLFORGE_CONFIG: join(work, "empty-config.json") });
  assert.equal(none.code, 3, none.stdout + none.stderr);
});
