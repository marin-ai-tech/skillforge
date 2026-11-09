// Acceptance tests for the server runtime and CLI contracts, run against built artifacts. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "packages", "server", "dist", "index.js");
const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const WEB_INDEX = join(ROOT, "packages", "web", "dist", "index.html");

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

function startServer(port, dataDir) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, SKILLFORGE_PORT: String(port), SKILLFORGE_HOST: "127.0.0.1", SKILLFORGE_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const exited = new Promise((res) => child.on("exit", (code, signal) => res({ code, signal })));
  return { child, exited, get out() { return out; }, get err() { return err; } };
}

async function waitHealthy(base, timeoutMs = Number(process.env.SKILLFORGE_TEST_START_TIMEOUT_MS) || 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/v1/health`);
      if (r.status === 200) return r;
      lastErr = new Error(`status ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${base} did not become healthy: ${lastErr}`);
}

async function stop(proc) {
  if (proc.child.exitCode === null) proc.child.kill();
  await Promise.race([proc.exited, new Promise((r) => setTimeout(r, 5000))]);
}

function run(args, env = {}) {
  return new Promise((res) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => res({ code, stdout, stderr }));
  });
}

let dataDir;
let port;
let base;
let server;

before(async () => {
  assert.ok(existsSync(SERVER), `built server not found: ${SERVER} — run npm run build`);
  assert.ok(existsSync(WEB_INDEX), `built SPA not found: ${WEB_INDEX} — run npm run build`);
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI} — run npm run build`);
  dataDir = mkdtempSync(join(tmpdir(), "skillforge-boot-"));
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = startServer(port, dataDir);
  await waitHealthy(base);
});

after(async () => {
  if (server) await stop(server);
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("health: 200, JSON, required fields", async () => {
  const r = await fetch(`${base}/api/v1/health`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
  const body = await r.json();
  assert.equal(body.status, "ok");
  assert.equal(body.db, "ok");
  assert.equal(typeof body.uptime_s, "number");
  assert.ok(typeof body.version === "string" && body.version.length > 0);
  // The data path is for admins only (tests/health-data-dir.test.mjs).
  assert.equal("data_dir" in body, false);
  // Outside a release there is no build commit.
  assert.equal(body.commit, null);
});

test("SPA: root serves index.html containing SkillForge", async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /^text\/html/);
  const html = await r.text();
  assert.ok(html.includes("SkillForge"), "index.html does not contain 'SkillForge'");
});

test("SPA fallback: a client route serves the same index.html", async () => {
  const [root, deep] = await Promise.all([fetch(`${base}/`), fetch(`${base}/artifacts/skills/some-name`)]);
  assert.equal(deep.status, 200);
  assert.equal(await deep.text(), await root.text());
});

test("API 404: an unknown route under /api/ returns JSON not_found", async () => {
  const r = await fetch(`${base}/api/v1/does-not-exist`);
  assert.equal(r.status, 404);
  assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
  assert.deepEqual(await r.json(), { error: "not_found" });
});

test("data directory: blobs/ and skillforge.db are created, migrations are registered", () => {
  assert.ok(existsSync(join(dataDir, "blobs")), "no blobs/ directory");
  assert.ok(existsSync(join(dataDir, "skillforge.db")), "no skillforge.db");
  const db = new DatabaseSync(join(dataDir, "skillforge.db"), { readOnly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get();
    assert.ok(Number(row.n) >= 1, "schema_migrations is empty");
  } finally {
    db.close();
  }
});

test("a second start on the same data directory does not duplicate migrations", async () => {
  const countMigrations = () => {
    const db = new DatabaseSync(join(dataDir, "skillforge.db"), { readOnly: true });
    try {
      return Number(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n);
    } finally {
      db.close();
    }
  };
  const before = countMigrations();
  await stop(server);
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = startServer(port, dataDir);
  const r = await waitHealthy(base);
  assert.equal((await r.json()).db, "ok");
  assert.equal(countMigrations(), before);
});

test("invalid SKILLFORGE_PORT: non-zero exit code and the variable name in stderr", async () => {
  const { code, stderr } = await run([SERVER], { SKILLFORGE_PORT: "abc", SKILLFORGE_DATA_DIR: dataDir });
  assert.notEqual(code, 0);
  assert.ok(stderr.includes("SKILLFORGE_PORT"), `stderr does not contain SKILLFORGE_PORT: ${stderr}`);
});

test("cli --version prints semver", async () => {
  const { code, stdout } = await run([CLI, "--version"]);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("cli health --url against a live server: JSON and exit code 0", async () => {
  const { code, stdout } = await run([CLI, "health", "--url", base]);
  assert.equal(code, 0, `stdout: ${stdout}`);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.status, "ok");
});

test("cli health against a closed port: exit code 1 and the URL in stderr", async () => {
  const dead = await freePort();
  const url = `http://127.0.0.1:${dead}`;
  const { code, stderr } = await run([CLI, "health", "--url", url]);
  assert.equal(code, 1);
  assert.ok(stderr.includes(url), `stderr does not contain ${url}: ${stderr}`);
});
