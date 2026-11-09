// Marketplace plugin sources: the oracle is the real Claude Code, not our
// idea of its format (a format test written from the same assumption as the code proves nothing).
// Requires `npm run build`.
// Binary: SKILLFORGE_CLAUDE_BIN, (Windows) %APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe of the desktop app
// or an npm install (`claude.cmd` in PATH); if none — skip.
// The client runs in a separate CLAUDE_CONFIG_DIR, without an API key: the model is not called, component loading is visible
// in the `init` event (stream-json) and the --debug log, which the client writes before contacting the API.
// The client accepts consent for a `command` source only in an interactive terminal — we do not give it here; instead
// we check that the entry is accepted and the command itself yields a catalog that the client validates and loads.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { startServer, ROOT } from "./lib/client.mjs";

const MIN_VERSION = [2, 1, 288];
const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const SEED = join(ROOT, "scripts", "seed-demo.ts");
const CALL_TIMEOUT_MS = 120_000;
const cleanup = [];

after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

function versionOf(bin) {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 60_000 });
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(r.stdout ?? "");
  return m ? m.slice(1, 4).map(Number) : null;
}

const atLeast = (v, min) => {
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
};

/**
 * Where the desktop app keeps Claude Code. It is an MSIX package: inside the app %APPDATA%\Claude is
 * virtualized, outside it (a plain terminal) the same files live under Packages\Claude_*\LocalCache\Roaming.
 */
function claudeCodeRoots() {
  const roots = [];
  if (process.env.APPDATA) roots.push(join(process.env.APPDATA, "Claude", "claude-code"));
  const packages = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Packages") : null;
  if (packages && existsSync(packages)) {
    for (const pkg of readdirSync(packages).filter((n) => n.startsWith("Claude_"))) {
      roots.push(join(packages, pkg, "LocalCache", "Roaming", "Claude", "claude-code"));
    }
  }
  return roots.filter((r) => existsSync(r));
}

function findClaude() {
  if (process.env.SKILLFORGE_CLAUDE_BIN) return process.env.SKILLFORGE_CLAUDE_BIN;
  if (process.platform !== "win32") return null;
  const found = [];
  for (const root of claudeCodeRoots()) for (const ver of readdirSync(root)) {
    const dir = join(root, ver);
    if (!statSync(dir).isDirectory()) continue;
    for (const hash of readdirSync(dir)) {
      const bin = join(dir, hash, "claude.exe");
      if (existsSync(bin)) found.push({ ver: ver.split(".").map(Number), bin });
    }
  }
  found.sort((a, b) => (atLeast(a.ver, b.ver) ? -1 : 1));
  return found[0]?.bin ?? npmClaude();
}

/** Claude Code installed with npm: the `claude.cmd` shim in PATH points at the real binary. */
function npmClaude() {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const shim = join(dir, "claude.cmd");
    if (!existsSync(shim)) continue;
    for (const m of readFileSync(shim, "utf8").matchAll(/"%dp0%\\([^"]+\.exe)"/g)) {
      const bin = join(dir, m[1]);
      if (!/^node\.exe$/i.test(m[1]) && existsSync(bin)) return bin;
    }
  }
  return null;
}

const CLAUDE = findClaude();
const CLAUDE_VERSION = CLAUDE ? versionOf(CLAUDE) : null;
const SKIP = !CLAUDE
  ? "Claude Code not found (set SKILLFORGE_CLAUDE_BIN)"
  : !CLAUDE_VERSION || !atLeast(CLAUDE_VERSION, MIN_VERSION)
    ? `Claude Code ${CLAUDE_VERSION?.join(".") ?? "?"} is older than ${MIN_VERSION.join(".")}`
    : false;

function tempDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

/** Client environment: its own Claude Code config, a `skillforge` shim in PATH, its own CLI config and cache. */
function clientEnv() {
  const shim = tempDir("skillforge-rc-shim-");
  if (process.platform === "win32") {
    writeFileSync(join(shim, "skillforge.cmd"), `@"${process.execPath}" "${CLI}" %*\r\n`);
  } else {
    writeFileSync(join(shim, "skillforge"), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
    chmodSync(join(shim, "skillforge"), 0o755);
  }
  const env = {
    ...process.env,
    PATH: `${shim}${delimiter}${process.env.PATH ?? ""}`,
    CLAUDE_CONFIG_DIR: tempDir("skillforge-rc-cc-"),
    SKILLFORGE_CONFIG: join(tempDir("skillforge-rc-cfg-"), "config.json"),
    SKILLFORGE_CACHE_DIR: tempDir("skillforge-rc-cache-"),
  };
  for (const k of ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) delete env[k];
  if (env.Path && env.PATH !== env.Path) delete env.Path;
  return env;
}

function claude(env, args, cwd) {
  const r = spawnSync(CLAUDE, args, { cwd, env, encoding: "utf8", timeout: CALL_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, stdout: r.stdout ?? "" };
}

/** Stand with demo data (`seed:demo`: active skill, command, agent, hook, plugin and a settings profile). */
async function demoStand(env = {}) {
  const srv = await startServer(env, { prefix: "skillforge-rc-" });
  cleanup.push(() => (srv.up ? srv.stop() : undefined));
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  const seed = spawnSync(process.execPath, ["--experimental-strip-types", SEED], {
    cwd: ROOT,
    env: { ...process.env, SKILLFORGE_DATA_DIR: srv.dataDir, NODE_ENV: "test" },
    encoding: "utf8",
    timeout: CALL_TIMEOUT_MS,
  });
  assert.equal(seed.status, 0, `seed:demo: ${seed.stdout}\n${seed.stderr}`);
  const mp = await (await fetch(`${srv.base}/marketplace.json`)).json();
  assert.equal(mp.plugins.length, 5, `five plugins are expected in the storefront: ${mp.plugins.map((p) => p.name)}`);
  return { srv, mp };
}

const INVALID_ENTRY = /entry is invalid|Invalid input|source type unsupported/i;

test("Claude Code: the local stand's marketplace is accepted, commands yield plugins that the client loads", { skip: SKIP, timeout: 900_000 }, async () => {
  const { srv, mp } = await demoStand();
  const env = clientEnv();
  const project = tempDir("skillforge-rc-proj-");

  const add = claude(env, ["plugin", "marketplace", "add", `${srv.base}/marketplace.json`], project);
  assert.equal(add.status, 0, add.out);
  assert.match(add.out, /Successfully added marketplace/i, add.out);

  const dirs = [];
  for (const p of mp.plugins) {
    const inst = claude(env, ["plugin", "install", `${p.name}@${mp.name}`], project);
    assert.doesNotMatch(inst.out, INVALID_ENTRY, `${p.name}: the client rejected the marketplace entry:\n${inst.out}`);
    assert.match(inst.out, /not been reviewed|was only displayed|Successfully installed/i, `${p.name}: unexpected install response:\n${inst.out}`);

    assert.equal(p.source?.source, "command", `${p.name}: a command source is expected on the http stand`);
    const run = spawnSync(p.source.command, { shell: true, cwd: homedir(), env, encoding: "utf8", timeout: CALL_TIMEOUT_MS });
    assert.equal(run.status, 0, `${p.name}: the command "${p.source.command}" finished with ${run.status}:\n${run.stdout}\n${run.stderr}`);
    const lines = run.stdout.split(/\r?\n/).filter((l) => l.length > 0);
    assert.equal(lines.length, 1, `${p.name}: the command must print exactly one line: ${JSON.stringify(run.stdout)}`);
    const dir = lines[0];
    assert.ok(isAbsolute(dir) && existsSync(join(dir, ".claude-plugin", "plugin.json")), `${p.name}: no plugin in ${dir}`);
    const val = claude(env, ["plugin", "validate", dir], project);
    assert.match(val.out, /Validation passed/i, `${p.name}: claude plugin validate:\n${val.out}`);
    dirs.push(dir);
  }

  const args = ["-p", "hi", "--output-format", "stream-json", "--verbose", "--debug"];
  for (const d of dirs) args.push("--plugin-dir", d);
  const run = claude(env, args, project);
  const init = run.stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l))
    .find((e) => e.type === "system" && e.subtype === "init");
  assert.ok(init, `no init event:\n${run.out.slice(0, 2000)}`);
  const names = (list) => (list ?? []).map((x) => (typeof x === "string" ? x : x.name));
  const loaded = [...names(init.slash_commands), ...names(init.skills), ...names(init.agents)];
  for (const want of ["demo-skill:demo-skill", "demo-command-command:demo-command", "demo-agent-agent:demo-agent", "demo-plugin:demo-plugin-skill"]) {
    assert.ok(loaded.includes(want), `the client did not load ${want}: ${loaded.filter((n) => n.startsWith("demo")).join(", ")}`);
  }
  const debugDir = join(env.CLAUDE_CONFIG_DIR, "debug");
  const debug = existsSync(debugDir) ? readdirSync(debugDir).map((f) => readFileSync(join(debugDir, f), "utf8")).join("\n") : "";
  assert.match(debug, /Loading hooks from plugin: demo-hook-hook/, "the client did not load the demo-hook-hook hooks");
});

test("Claude Code: an archive entry (https deployment) is accepted by the client", { skip: SKIP, timeout: 600_000 }, async () => {
  const { srv, mp } = await demoStand({ SKILLFORGE_BASE_URL: "https://skillforge.invalid" });
  const env = clientEnv();
  const project = tempDir("skillforge-rc-proj-");
  mkdirSync(project, { recursive: true });
  const add = claude(env, ["plugin", "marketplace", "add", `${srv.base}/marketplace.json`], project);
  assert.equal(add.status, 0, add.out);
  const skill = mp.plugins.find((p) => p.name === "demo-skill");
  assert.equal(skill.source?.source, "archive");
  const inst = claude(env, ["plugin", "install", `demo-skill@${mp.name}`], project);
  assert.notEqual(inst.status, 0, "host skillforge.invalid is unreachable — installation cannot succeed");
  assert.doesNotMatch(inst.out, INVALID_ENTRY, `the client rejected the archive entry:\n${inst.out}`);
});
