// Acceptance tests for the 0.2.0 distribution. `npm run release` (here — `node scripts/release.mjs --skip-build --out <tmp>`) builds
// the archives, the CLI package, the Windows installer and checksums; the archive runs in a clean folder without sources; the CLI is installed from
// the registry; the installer installs SkillForge with the bundled Node in no-task mode and without administrator rights.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { ROOT, freePort } from "./lib/client.mjs";

const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const WIN = process.platform === "win32";
// Windows: the system bsdtar; Git Bash puts GNU tar first in PATH, and it reads "C:" as a remote host, so without
// bsdtar GNU tar gets --force-local (as in scripts/release.mjs).
const SYS_TAR = join(process.env.WINDIR ?? "C:\\Windows", "System32", "tar.exe");
const [TAR, TAR_ARGS] = !WIN ? ["tar", []] : existsSync(SYS_TAR) ? [SYS_TAR, []] : ["tar", ["--force-local"]];
const COMMIT = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
let work;
let out;
const servers = [];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 600_000, shell: WIN && /\.(cmd|bat)$/i.test(cmd), ...opts });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

/** Starts a long-running process; it is stopped by its listening port in `after` (PowerShell Stop-Process on Windows). */
function startProcess(cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, log: () => log };
}

async function waitHealth(base, proc) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/v1/health`);
      if (r.status === 200) return r.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not start at ${base}:\n${proc.log()}`);
}

function stopByPort(port) {
  if (WIN) {
    spawnSync("powershell", [
      "-NoProfile",
      "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
    ]);
  }
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

before(() => {
  work = mkdtempSync(join(tmpdir(), "skillforge-release-"));
  out = join(work, "release");
  const r = run(process.execPath, [join(ROOT, "scripts", "release.mjs"), "--skip-build", "--out", out], { cwd: ROOT });
  assert.equal(r.code, 0, `release failed:\n${r.out.slice(-4000)}`);
});

after(() => {
  for (const s of servers) {
    try {
      s.proc.child.kill();
    } catch {
      /* gone */
    }
    stopByPort(s.port);
  }
  rmSync(work, { recursive: true, force: true });
});

test("release contents and checksums", () => {
  const expected = [`skillforge-${VERSION}.zip`, `skillforge-${VERSION}.tar.gz`, `skillforge-cli-${VERSION}.tgz`, "SHA256SUMS.txt", "RELEASE-NOTES.md"];
  expected.push(`skillforge-setup-${VERSION}.exe`);
  for (const f of expected) assert.ok(existsSync(join(out, f)), `missing ${f}`);
  const sums = readFileSync(join(out, "SHA256SUMS.txt"), "utf8").trim().split(/\r?\n/);
  const listed = new Set();
  for (const line of sums) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    assert.ok(m, `checksum line: ${line}`);
    listed.add(m[2]);
    const actual = createHash("sha256").update(readFileSync(join(out, m[2]))).digest("hex");
    assert.equal(actual, m[1], `checksum of ${m[2]}`);
  }
  for (const f of expected.filter((x) => x !== "SHA256SUMS.txt")) assert.ok(listed.has(f), `${f} is not in SHA256SUMS.txt`);
  const notes = readFileSync(join(out, "RELEASE-NOTES.md"), "utf8");
  assert.ok(notes.includes(VERSION));
  assert.ok(notes.includes(COMMIT), "the release notes do not name the build commit");
});

test("the installer is built on this system: NSIS, a PE file with the bundled Node", () => {
  const exe = readFileSync(join(out, `skillforge-setup-${VERSION}.exe`));
  assert.ok(exe.length > 30 * 1024 * 1024, "the installer must contain Node.js");
  assert.equal(exe.subarray(0, 2).toString("latin1"), "MZ");
  assert.ok(exe.includes("NullsoftInst"), "not an NSIS installer");
});

test("archive: everything needed to run, without sources and development tools", () => {
  const dest = join(work, "tar");
  mkdirSync(dest);
  assert.equal(run(TAR, [...TAR_ARGS, "-xzf", join(out, `skillforge-${VERSION}.tar.gz`), "-C", dest]).code, 0);
  const root = join(dest, `skillforge-${VERSION}`);
  for (const rel of [
    "start.cmd",
    "start.ps1",
    "start.sh",
    "skillforge.env.example",
    "INSTALL.md",
    "docker/Dockerfile",
    "docker/docker-compose.yml",
    "packages/server/dist/index.js",
    "packages/server/migrations/0029_artifact_agents.sql",
    "packages/server/starter-packs",
    "packages/server/bundled-plugins/review-assistant/skillforge-plugin.json",
    "packages/server/bundled-plugins/review-assistant/llm-reviewer.js",
    "packages/web/dist/index.html",
    "packages/web/dist/help-corpus/en/getting-started/install.md",
    "node_modules/fastify/package.json",
    `downloads/skillforge-cli-${VERSION}.tgz`,
    "downloads/skillforge-cli.tgz",
  ]) {
    assert.ok(existsSync(join(root, rel)), `the archive lacks ${rel}`);
  }
  for (const rel of ["packages/server/src", "packages/web/src", "tests", ".git", "node_modules/vite", "node_modules/typescript", "node_modules/@playwright"]) {
    assert.ok(!existsSync(join(root, rel)), `the archive contains an extra: ${rel}`);
  }
  const pkg = JSON.parse(readFileSync(join(root, "packages/server/package.json"), "utf8"));
  assert.equal(pkg.version, VERSION);
  const zip = unzipSync(new Uint8Array(readFileSync(join(out, `skillforge-${VERSION}.zip`))), {
    filter: (f) => /(^|\/)(start\.cmd|index\.js|INSTALL\.md)$/.test(f.name),
  });
  const names = Object.keys(zip);
  assert.ok(names.includes(`skillforge-${VERSION}/start.cmd`), names.join(", "));
  assert.ok(names.includes(`skillforge-${VERSION}/packages/server/dist/index.js`));
});

test("the archive runs by script in a clean folder; the CLI is installed from the registry; /downloads serves nothing extra", async () => {
  const root = join(work, "tar", `skillforge-${VERSION}`);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  writeFileSync(
    join(root, "skillforge.env"),
    `SKILLFORGE_PORT=${port}\nSKILLFORGE_HOST=127.0.0.1\nSKILLFORGE_DATA_DIR=${join(work, "data-archive").replace(/\\/g, "/")}\nSKILLFORGE_ADMIN_PASSWORD=release-test-pw\n`,
  );
  const proc = WIN
    ? // Full path: with NoDefaultCurrentDirectoryInExePath=1 cmd does not look in the current folder.
      startProcess("cmd.exe", ["/d", "/c", join(root, "start.cmd")], { cwd: root })
    : startProcess("sh", ["start.sh"], { cwd: root });
  servers.push({ proc, port });
  const health = await waitHealth(base, proc);
  assert.equal(health.version, VERSION);
  // #123: the build is identified; anonymously nothing else new appears next to the commit.
  assert.equal(health.commit, COMMIT);
  // llm-skill-validation: the plugin that ships in the build loads by itself.
  assert.equal(health.plugins.errors, 0, JSON.stringify(health.plugins));
  assert.ok(health.plugins.loaded >= 1, JSON.stringify(health.plugins));
  assert.deepEqual(Object.keys(health).sort(), ["artifacts", "commit", "db", "orchestration_enabled", "plugins", "status", "uptime_s", "version"]);
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<div id="root">/);
  assert.equal((await fetch(`${base}/help-corpus/en/getting-started/install.md`)).status, 200);

  const info = await (await fetch(`${base}/api/v1/install-info`)).json();
  assert.deepEqual(info.cli, { version: VERSION, url: `${base}/downloads/skillforge-cli.tgz` });
  for (const path of ["/downloads/skillforge-cli.tgz", `/downloads/skillforge-cli-${VERSION}.tgz`]) {
    assert.equal((await fetch(`${base}${path}`)).status, 200, path);
  }
  for (const path of ["/downloads/..%2Fpackage.json", "/downloads/skillforge-cli.tgz.bak", "/downloads/x.tgz", "/downloads/..%5Cstart.cmd"]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  // A dot-segment path never reaches /downloads/:file (URL normalisation makes it /start.cmd), so the SPA page answers:
  // the oracle is "the file itself never leaks", not the status.
  for (const path of ["/downloads/%2e%2e/start.cmd", "/downloads/../start.cmd"]) {
    const r = await fetch(`${base}${path}`);
    const text = await r.text();
    assert.ok(!/@echo off/.test(text), `${path} served start.cmd`);
    assert.ok(r.status === 404 || /<div id="root">/.test(text), `${path}: ${r.status}`);
  }

  const prefix = join(work, "cli");
  const npm = WIN ? "npm.cmd" : "npm";
  const inst = run(npm, ["i", "-g", "--prefix", prefix, "--no-audit", "--no-fund", info.cli.url]);
  assert.equal(inst.code, 0, inst.out);
  const bin = WIN ? join(prefix, "skillforge.cmd") : join(prefix, "bin", "skillforge");
  const ver = run(bin, ["--version"]);
  assert.equal(ver.code, 0, ver.out);
  assert.equal(ver.out.trim(), VERSION);
  const list = run(bin, ["list", "--url", base]);
  assert.equal(list.code, 0, list.out);
});

test("Windows installer: bundled Node, no-task installation into temporary folders", { skip: !WIN && "Windows only" }, async () => {
  const exe = join(out, `skillforge-setup-${VERSION}.exe`);
  const ex = join(work, "setup");
  mkdirSync(ex);
  // NSIS: /EXTRACT= only unpacks, /S runs without windows.
  const r = spawnSync(exe, ["/S", `/EXTRACT=${ex}`], { timeout: 300_000 });
  assert.equal(r.status, 0, `unpacking the installer: ${r.status}`);
  for (const f of ["payload.zip", "install.ps1", "uninstall.ps1"]) assert.ok(existsSync(join(ex, f)), `the installer lacks ${f}`);

  const port = await freePort();
  const prog = join(work, "prog");
  const data = join(work, "data-installer");
  const install = run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ex, "install.ps1"), "-NoTask", "-Quiet", "-InstallDir", prog, "-DataDir", data, "-Port", String(port)]);
  assert.equal(install.code, 0, install.out);
  assert.ok(existsSync(join(prog, VERSION, "node", "node.exe")), "bundled node.exe");
  assert.ok(existsSync(join(prog, "current", "packages", "server", "dist", "index.js")), "the current pointer");
  assert.ok(existsSync(join(data, "skillforge.env")), "settings in the data folder");

  const proc = startProcess("cmd.exe", ["/d", "/c", join(prog, "skillforge.cmd")], { cwd: prog });
  servers.push({ proc, port });
  const health = await waitHealth(`http://127.0.0.1:${port}`, proc);
  assert.equal(health.version, VERSION);
  assert.ok(walk(data).some((f) => f.endsWith(".db")), "database in the data folder");
});
