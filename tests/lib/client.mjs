// Shared helpers for the acceptance node tests: starting the built server, login, requests with a cookie/token.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SERVER = join(ROOT, "packages", "server", "dist", "index.js");
export const FIXTURES = join(ROOT, "tests", "fixtures", "artifacts");
export const ADMIN_PASSWORD = "test-admin-pw";

export function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

export function loadDir(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: relative(dir, p).replace(/\\/g, "/"), content: readFileSync(p) });
    }
  };
  walk(dir);
  return out;
}

export const toB64 = (files) =>
  files.map((f) => ({ path: f.path, content_base64: Buffer.from(f.content).toString("base64") }));

/** Starts the built server on a free port with a temporary data directory. */
export async function startServer(env = {}, { prefix = "skillforge-test-", port: fixedPort } = {}) {
  assert.ok(existsSync(SERVER), `built server not found: ${SERVER} — run npm run build`);
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  const port = fixedPort ?? (await freePort());
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      SKILLFORGE_PORT: String(port),
      SKILLFORGE_HOST: "127.0.0.1",
      SKILLFORGE_DATA_DIR: dataDir,
      SKILLFORGE_ADMIN_PASSWORD: ADMIN_PASSWORD,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise((r) => child.on("exit", (code) => r(code)));
  // 15 s turned out to be too little when several jobs run in parallel on the machine (flake 2026-09-22):
  // 30 s by default, overridable with SKILLFORGE_TEST_START_TIMEOUT_MS.
  const deadline = Date.now() + (Number(process.env.SKILLFORGE_TEST_START_TIMEOUT_MS) || 30000);
  // Only our own process: freePort releases the port before the start, and the port may be taken by a server of a neighbouring test
  // with other settings. Its answer on /health must not be taken for our own.
  let up = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      if (stdout.includes("SkillForge listening on")) {
        const r = await fetch(`${base}/api/v1/health`);
        if (r.status === 200) {
          up = true;
          break;
        }
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const stop = async () => {
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    rmSync(dataDir, { recursive: true, force: true });
  };
  if (!up) {
    const code = child.exitCode;
    await stop();
    return { up: false, exitCode: code, stdout, stderr, base, dataDir };
  }
  return {
    up: true,
    base,
    dataDir,
    child,
    stop,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

/** Generic request: auth = { cookie } | { token } | undefined. Returns { status, headers, data }. */
export async function api(base, method, path, body, auth = {}, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth.cookie) headers.cookie = auth.cookie;
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  const r = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const ct = r.headers.get("content-type") ?? "";
  let data = null;
  if (ct.startsWith("application/json")) data = await r.json();
  else if (r.status !== 204) data = await r.arrayBuffer();
  return { status: r.status, headers: r.headers, data };
}

/** Login; returns { cookie, user }. Throws on failure. */
export async function login(base, username, password) {
  const r = await api(base, "POST", "/api/v1/auth/login", { username, password });
  assert.equal(r.status, 200, `login of ${username} failed: ${r.status} ${JSON.stringify(r.data)}`);
  const setCookie = r.headers.get("set-cookie") ?? "";
  const m = /sf_session=([^;]+)/.exec(setCookie);
  assert.ok(m, `no sf_session cookie in the login response: ${setCookie}`);
  return { cookie: `sf_session=${m[1]}`, user: r.data.user, setCookie };
}

/** Creates a user on behalf of the administrator (admin cookie) and returns it. */
export async function createUser(base, adminCookie, { username, password, role, display_name }) {
  const r = await api(base, "POST", "/api/v1/admin/users", { username, password, role, display_name }, { cookie: adminCookie });
  assert.equal(r.status, 201, `creating ${username} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
