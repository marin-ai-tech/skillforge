// Acceptance tests for self-hosting with Docker. Requires `npm run build`.
// There is no Docker on the development machine: the image is checked statically, the runtime stage by simulation
// (`npm ci --omit=dev` in a copy of the layout + starting the server), the backup by a real restore into a second server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD, freePort } from "./lib/client.mjs";

const NAME_RE = /^skillforge-\d{8}T\d{6}Z\.tar\.gz$/;
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// Starts a process and waits for it to exit for at most 15 s: a server that ignored an invalid configuration
// must not hang the test — it is killed, and code = null counts as an error.
function runNode(args, env, cwd = ROOT) {
  return new Promise((res) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 15000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr: code === null ? `${stderr}\n(process did not exit within 15s — killed)` : stderr });
    });
  });
}

let srv;
let base;
let admin;
let bob;
let aliceToken;
const cleanup = [];

before(async () => {
  srv = await startServer({ SKILLFORGE_BACKUP_KEEP: "2" }, { prefix: "skillforge-selfhost-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  await createUser(base, admin.cookie, { username: "bob", password: "bob-pw-123", role: "viewer" });
  bob = await login(base, "bob", "bob-pw-123");
  const alice = await login(base, "alice", "alice-pw-1");
  aliceToken = (await api(base, "POST", "/api/v1/me/tokens", { name: "t" }, { cookie: alice.cookie })).data.token;
  for (const [type, dir, extra] of [
    ["skill", "skill-standard", {}],
    ["skill", "skill-e2e", { version: "1.0.0" }],
    ["command", "command-propose", {}],
    ["hook", "hook-guard", { name: "destructive-guard" }],
  ]) {
    const r = await api(base, "POST", "/api/v1/artifacts", { type, ...extra, files: toB64(loadDir(join(FIXTURES, dir))) }, { token: aliceToken });
    assert.equal(r.status, 201, `${type}/${dir}: ${r.status} ${JSON.stringify(r.data)}`);
  }
});

after(async () => {
  if (srv?.up) await srv.stop();
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});

test("Dockerfile, .dockerignore, docker-compose.yml and .env.example: structure", () => {
  const df = read("Dockerfile");
  assert.ok((df.match(/^FROM\s+node:24/gim) ?? []).length >= 2, "multi-stage build on node:26");
  assert.match(df, /^USER\s+node\s*$/m);
  assert.match(df, /^EXPOSE\s+8787/m);
  assert.match(df, /^VOLUME\s+(\["\/data"\]|\/data)/m);
  assert.match(df, /^HEALTHCHECK[\s\S]*\/api\/v1\/health/m);
  assert.match(df, /SKILLFORGE_HOST=0\.0\.0\.0/);
  assert.match(df, /SKILLFORGE_DATA_DIR=\/data/);
  assert.match(df, /npm ci --omit=dev/);
  assert.match(df, /^CMD\s+\[\s*"node",\s*"packages\/server\/dist\/index\.js"\s*\]/m);
  const di = read(".dockerignore");
  for (const line of ["node_modules", "data", ".git"]) assert.ok(new RegExp(`^\\**/?${line.replace(".", "\\.")}/?\\s*$`, "m").test(di), `.dockerignore: ${line}`);
  const compose = read("docker-compose.yml");
  assert.match(compose, /^\s+skillforge:\s*$/m);
  assert.match(compose, /8787:8787/);
  assert.match(compose, /:\/data\s*$/m);
  assert.match(compose, /env_file:/);
  assert.match(compose, /restart:\s*unless-stopped/);
  assert.match(compose, /^volumes:\s*$/m);
});

// .dockerignore was maintained separately from .gitignore — local artifacts absent from git
// (tsconfig.tsbuildinfo, .env, .codegraph/…) got into the build context, and after `npm run build` on the host
// `tsc -b` in the image considered the build up to date and did not write dist/. Closing the class: whatever git ignores, Docker ignores too.
test(".dockerignore covers every .gitignore pattern", () => {
  const norm = (l) => l.trim().replace(/\/+$/, "").replace(/^\/+/, "");
  const di = new Set(read(".dockerignore").split(/\r?\n/).map(norm).filter((l) => l && !l.startsWith("#")));
  const missing = read(".gitignore")
    .split(/\r?\n/)
    .map(norm)
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    // git: a pattern without "/" applies at any depth; Docker: only at the root — "**/" is needed.
    .filter((p) => !(p.includes("/") ? di.has(p) || di.has(`**/${p}`) : di.has(`**/${p}`)));
  assert.deepEqual(missing, [], `.dockerignore does not exclude: ${missing.join(", ")}`);
});

test(".env.example and docs/en/03-self-hosting.md list every SKILLFORGE_* variable of the server", () => {
  const cfg = read("packages/server/src/config.ts");
  const vars = [...new Set(cfg.match(/SKILLFORGE_[A-Z_]+/g))].filter((v) => v !== "SKILLFORGE_");
  assert.ok(vars.includes("SKILLFORGE_BACKUP_KEEP"), "config.ts does not read SKILLFORGE_BACKUP_KEEP");
  const envExample = read(".env.example");
  const doc = read("docs/en/03-self-hosting.md");
  for (const v of vars) {
    assert.ok(envExample.includes(v), `.env.example: missing ${v}`);
    assert.ok(doc.includes(v), `docs/en/03-self-hosting.md: missing ${v}`);
  }
  for (const word of ["docker compose up", "VACUUM", "tar -xzf", "backups", "initial-admin-password.txt"]) {
    assert.ok(doc.includes(word), `docs/en/03-self-hosting.md: missing "${word}"`);
  }
  assert.ok(read("README.md").includes("docs/en/03-self-hosting.md"), "README does not link to docs/en/03-self-hosting.md");
});

test("the runtime layout without dev dependencies starts and serves the SPA", { timeout: 300000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "skillforge-runtime-"));
  cleanup.push(dir);
  for (const f of ["package.json", "package-lock.json"]) cpSync(join(ROOT, f), join(dir, f));
  for (const pkg of ["core", "server", "cli", "web"]) {
    mkdirSync(join(dir, "packages", pkg), { recursive: true });
    cpSync(join(ROOT, "packages", pkg, "package.json"), join(dir, "packages", pkg, "package.json"));
    cpSync(join(ROOT, "packages", pkg, "dist"), join(dir, "packages", pkg, "dist"), { recursive: true });
  }
  cpSync(join(ROOT, "packages", "server", "migrations"), join(dir, "packages", "server", "migrations"), { recursive: true });
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const ci = spawnSync(npm, ["ci", "--omit=dev", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund"], { cwd: dir, encoding: "utf8", shell: process.platform === "win32", timeout: 240000 });
  assert.equal(ci.status, 0, `npm ci --omit=dev: ${ci.stderr}\n${ci.stdout}`);
  assert.ok(!existsSync(join(dir, "node_modules", "typescript")), "typescript got into the production layout");
  assert.ok(!existsSync(join(dir, "node_modules", "vite")), "vite got into the production layout");
  assert.ok(existsSync(join(dir, "node_modules", "fastify")));
  const port = await freePort();
  const dataDir = join(dir, "data");
  const child = spawn(process.execPath, ["packages/server/dist/index.js"], {
    cwd: dir,
    env: { ...process.env, SKILLFORGE_PORT: String(port), SKILLFORGE_HOST: "127.0.0.1", SKILLFORGE_DATA_DIR: dataDir, SKILLFORGE_ADMIN_PASSWORD: ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise((r) => child.on("exit", r));
  try {
    let health = null;
    // As in tests/lib/client.mjs: 15 s was flaky under load from parallel runs.
    const deadline = Date.now() + (Number(process.env.SKILLFORGE_TEST_START_TIMEOUT_MS) || 30000);
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
        if (r.status === 200) {
          health = await r.json();
          break;
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(health, `the server from the runtime layout did not start: ${stderr}`);
    assert.equal(health.db, "ok");
    const home = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(home.status, 200);
    assert.ok((await home.text()).includes("SkillForge"));
  } finally {
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
});

test("backup: permissions, creation, list, archive contents", async () => {
  const anon = await api(base, "POST", "/api/v1/admin/backups");
  assert.equal(anon.status, 401);
  const viewer = await api(base, "POST", "/api/v1/admin/backups", undefined, { cookie: bob.cookie });
  assert.equal(viewer.status, 403);
  const viewerList = await api(base, "GET", "/api/v1/admin/backups", undefined, { cookie: bob.cookie });
  assert.equal(viewerList.status, 403);

  const created = await api(base, "POST", "/api/v1/admin/backups", undefined, { cookie: admin.cookie });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const b = created.data.backup;
  assert.match(b.name, NAME_RE);
  assert.ok(b.size > 0);
  assert.ok(typeof b.created_at === "string" && !Number.isNaN(Date.parse(b.created_at)));
  assert.equal(b.counts.artifacts, 4);
  assert.equal(b.counts.versions, 4);
  assert.equal(b.counts.users, 3);
  assert.ok(b.counts.blobs >= 5, `blobs=${b.counts.blobs}`);
  const file = join(srv.dataDir, "backups", b.name);
  assert.ok(existsSync(file), `no file ${file}`);
  assert.equal(statSync(file).size, b.size);

  const list = await api(base, "GET", "/api/v1/admin/backups", undefined, { cookie: admin.cookie });
  assert.equal(list.status, 200);
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].name, b.name);
  assert.equal(list.data.items[0].size, b.size);
  assert.equal(list.data.dir, join(srv.dataDir, "backups"));

  const dl = await fetch(`${base}/api/v1/admin/backups/${b.name}`, { headers: { cookie: admin.cookie } });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-type"), "application/gzip");
  assert.equal(dl.headers.get("content-disposition"), `attachment; filename="${b.name}"`);
  assert.equal(Number(dl.headers.get("content-length")), b.size);
  const bytes = Buffer.from(await dl.arrayBuffer());
  assert.equal(bytes.length, b.size);
  assert.equal(bytes[0], 0x1f);
  assert.equal(bytes[1], 0x8b);

  const listing = spawnSync("tar", ["-tzf", b.name], { cwd: join(srv.dataDir, "backups"), encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean).map((e) => e.replace(/^\.\//, ""));
  assert.ok(entries.includes("skillforge.db"), entries.join(","));
  assert.ok(entries.includes("manifest.json"), entries.join(","));
  assert.ok(entries.filter((e) => /^blobs\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(e)).length >= 5, entries.join(","));
  assert.ok(!entries.some((e) => e.startsWith("backups/") || e.includes("-wal") || e.includes("-shm") || e.includes("initial-admin-password")), entries.join(","));
});

test("restore: an unpacked archive comes up as a second server with the same data", async () => {
  const list = await api(base, "GET", "/api/v1/admin/backups", undefined, { cookie: admin.cookie });
  const name = list.data.items[0].name;
  const restored = mkdtempSync(join(tmpdir(), "skillforge-restore-"));
  cleanup.push(restored);
  const x = spawnSync("tar", ["-xzf", join(srv.dataDir, "backups", name).replace(/\\/g, "/"), "-C", restored.replace(/\\/g, "/")], { encoding: "utf8" });
  if (x.status !== 0) {
    // GNU tar on Windows reads `C:\…` as a host — use relative paths
    cpSync(join(srv.dataDir, "backups", name), join(restored, name));
    const y = spawnSync("tar", ["-xzf", name], { cwd: restored, encoding: "utf8" });
    assert.equal(y.status, 0, y.stderr);
    rmSync(join(restored, name));
  }
  assert.ok(existsSync(join(restored, "skillforge.db")));
  const manifest = JSON.parse(readFileSync(join(restored, "manifest.json"), "utf8"));
  assert.equal(manifest.format, 1);
  assert.equal(manifest.counts.artifacts, 4);
  assert.ok(typeof manifest.server_version === "string" && manifest.server_version.length > 0);
  assert.ok(Number.isInteger(manifest.migrations) && manifest.migrations >= 4);

  const second = await startServer({ SKILLFORGE_DATA_DIR: restored }, { prefix: "skillforge-restore-srv-" });
  assert.ok(second.up, `the restored server did not start: ${second.stderr}`);
  try {
    const health = await api(second.base, "GET", "/api/v1/health");
    assert.equal(health.data.db, "ok");
    assert.equal(health.data.artifacts, 4);
    const adm = await login(second.base, "admin", ADMIN_PASSWORD);
    const users = await api(second.base, "GET", "/api/v1/admin/users", undefined, { cookie: adm.cookie });
    assert.deepEqual(users.data.items.map((u) => u.username).sort(), ["admin", "alice", "bob"]);
    const orig = await api(base, "GET", "/api/v1/artifacts?limit=50", undefined, { cookie: admin.cookie });
    const copy = await api(second.base, "GET", "/api/v1/artifacts?limit=50", undefined, { cookie: adm.cookie });
    assert.deepEqual(copy.data.items.map((a) => `${a.type}/${a.name}@${a.latest_version}`).sort(), orig.data.items.map((a) => `${a.type}/${a.name}@${a.latest_version}`).sort());
    const zip = await fetch(`${second.base}/api/v1/artifacts/skill/pdf-tools/versions/0.1.0/bundle.zip`, { headers: { cookie: adm.cookie } });
    assert.equal(zip.status, 200);
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    assert.ok(Object.keys(files).includes("skills/pdf-tools/SKILL.md"), Object.keys(files).join(","));
    assert.ok(existsSync(join(restored, "blobs")));
    const inRestored = await api(second.base, "GET", "/api/v1/admin/backups", undefined, { cookie: adm.cookie });
    assert.equal(inRestored.data.items.length, 0, "the backups directory must not get into the archive");
  } finally {
    await second.stop();
  }
});

test("names: directory traversal and foreign names → 404; deletion → 204; retention SKILLFORGE_BACKUP_KEEP=2", async () => {
  for (const bad of ["..%2Fskillforge.db", "skillforge-x.tar.gz", "skillforge-20260918T120000Z.tar.gz.bak", "%2e%2e%2f%2e%2e%2fskillforge.db"]) {
    const r = await api(base, "GET", `/api/v1/admin/backups/${bad}`, undefined, { cookie: admin.cookie });
    assert.equal(r.status, 404, `${bad}: ${r.status}`);
    const d = await api(base, "DELETE", `/api/v1/admin/backups/${bad}`, undefined, { cookie: admin.cookie });
    assert.equal(d.status, 404, `DELETE ${bad}: ${d.status}`);
  }
  assert.ok(existsSync(join(srv.dataDir, "skillforge.db")));
  const missing = await api(base, "GET", "/api/v1/admin/backups/skillforge-20200101T000000Z.tar.gz", undefined, { cookie: admin.cookie });
  assert.equal(missing.status, 404);

  const names = [];
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, 1100));
    const c = await api(base, "POST", "/api/v1/admin/backups", undefined, { cookie: admin.cookie });
    assert.equal(c.status, 201, JSON.stringify(c.data));
    names.push(c.data.backup.name);
  }
  const list = await api(base, "GET", "/api/v1/admin/backups", undefined, { cookie: admin.cookie });
  assert.equal(list.data.items.length, 2, JSON.stringify(list.data));
  assert.deepEqual(list.data.items.map((i) => i.name), [names[1], names[0]]);
  assert.deepEqual(readdirSync(join(srv.dataDir, "backups")).filter((f) => NAME_RE.test(f)).sort(), [...names].sort());

  const del = await api(base, "DELETE", `/api/v1/admin/backups/${names[0]}`, undefined, { cookie: admin.cookie });
  assert.equal(del.status, 204);
  assert.ok(!existsSync(join(srv.dataDir, "backups", names[0])));
  const viewerDel = await api(base, "DELETE", `/api/v1/admin/backups/${names[1]}`, undefined, { cookie: bob.cookie });
  assert.equal(viewerDel.status, 403);
  assert.ok(existsSync(join(srv.dataDir, "backups", names[1])));
  const again = await api(base, "DELETE", `/api/v1/admin/backups/${names[0]}`, undefined, { cookie: admin.cookie });
  assert.equal(again.status, 404);
});

test("SKILLFORGE_BACKUP_KEEP=abc → the server does not start and names the variable", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "skillforge-badkeep-"));
  cleanup.push(dataDir);
  const port = await freePort();
  const r = await runNode([join(ROOT, "packages", "server", "dist", "index.js")], { SKILLFORGE_BACKUP_KEEP: "abc", SKILLFORGE_PORT: String(port), SKILLFORGE_DATA_DIR: dataDir });
  assert.ok(r.code !== 0 && r.code !== null, `a non-zero exit code was expected: ${r.code} ${r.stderr}`);
  assert.ok(r.stderr.includes("SKILLFORGE_BACKUP_KEEP"), r.stderr);
  const zero = await runNode([join(ROOT, "packages", "server", "dist", "index.js")], { SKILLFORGE_BACKUP_KEEP: "0", SKILLFORGE_PORT: String(port), SKILLFORGE_DATA_DIR: dataDir });
  assert.ok(zero.code !== 0 && zero.code !== null, `a non-zero exit code was expected: ${zero.code} ${zero.stderr}`);
  assert.ok(zero.stderr.includes("SKILLFORGE_BACKUP_KEEP"), zero.stderr);
});
