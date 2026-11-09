// Installation with
// `skillforge install --runtime codex|opencode|qwen` is verified by the client ITSELF, without calling the model:
//   Codex     — `codex debug prompt-input` (skill roots), the agent is TOML with three keys;
//   OpenCode  — `opencode debug skill`, `opencode agent list` (and no "Configuration is invalid");
//   Qwen Code — `qwen serve` → GET /workspaces/<path>/skills|agents.
// Home directories are isolated (HOME/USERPROFILE, CODEX_HOME, XDG_*, QWEN_HOME); every process has a kill-timeout.
// Binary: SKILLFORGE_<CLIENT>_BIN (path to .js/.exe) or an npm wrapper `<client>.cmd` in PATH; if none — skip with a reason.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { startServer, api, login, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const CALL_TIMEOUT_MS = 120_000;
const MARKERS = ["pdf-tools", "rt-user-skill", "quirky-agent"];
let srv;
let base;
let work;

/** Resolves a client to { cmd, pre } without a shell, so kill() reaches the real process. */
function findClient(name) {
  const fromEnv = process.env[`SKILLFORGE_${name.toUpperCase()}_BIN`];
  const target = fromEnv ?? shimTarget(name);
  if (!target || !existsSync(target)) return null;
  return target.endsWith(".js") ? { cmd: process.execPath, pre: [target] } : { cmd: target, pre: [] };
}

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

const CLIENTS = { codex: findClient("codex"), opencode: findClient("opencode"), qwen: findClient("qwen") };

function homeEnv(home) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: join(home, ".codex"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    QWEN_HOME: join(home, ".qwen"),
    NO_COLOR: "1",
  };
}

/** Runs a client inside a sandbox `{ proj, home }` (cwd = proj). */
function run(client, args, { proj, home }) {
  const c = CLIENTS[client];
  const r = spawnSync(c.cmd, [...c.pre, ...args], {
    cwd: proj,
    env: homeEnv(home),
    encoding: "utf8",
    timeout: CALL_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, error: r.error };
}

/** Runs the SkillForge CLI inside a sandbox `{ proj, home }` (cwd = proj). */
function sf(args, { proj, home }) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: proj,
    env: { ...homeEnv(home), SKILLFORGE_CONFIG: join(work, "config.json"), SKILLFORGE_URL: base, SKILLFORGE_TOKEN: undefined },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 0, `skillforge ${args.join(" ")}: ${r.stdout}\n${r.stderr}`);
  return r;
}

function sandbox(name) {
  const root = join(work, name);
  const proj = join(root, "proj");
  const home = join(root, "home");
  mkdirSync(proj, { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true }); // Codex requires an existing CODEX_HOME
  spawnSync("git", ["init", "-q", "."], { cwd: proj, timeout: 30_000 });
  return { proj, home };
}

function installAll(runtime, ctx) {
  sf(["install", "skill/pdf-tools", "--runtime", runtime], ctx);
  sf(["install", "skill/rt-user-skill", "--runtime", runtime, "--scope", "user"], ctx);
  sf(["install", "agent/quirky-agent", "--runtime", runtime], ctx);
}

async function publishActive(admin, body, type, name) {
  const p = await api(base, "POST", "/api/v1/artifacts", body, { cookie: admin.cookie });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const t = await api(base, "POST", `/api/v1/artifacts/${type}/${name}/transitions`, { to: "active", reason: "real client" }, { cookie: admin.cookie });
  assert.equal(t.status, 200);
}

const b64 = (s) => Buffer.from(s).toString("base64");

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-real-runtimes-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  const admin = await login(base, "admin", ADMIN_PASSWORD);
  work = mkdtempSync(join(tmpdir(), "skillforge-real-runtimes-"));
  await publishActive(admin, { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, "skill", "pdf-tools");
  const userSkill = "---\nname: rt-user-skill\ndescription: User-scope probe skill for real client checks.\n---\nProbe body.\n";
  await publishActive(admin, { type: "skill", files: [{ path: "rt-user-skill/SKILL.md", content_base64: b64(userSkill) }] }, "skill", "rt-user-skill");
  const agent = "---\nname: quirky-agent\ndescription: Probe agent with Claude-only keys.\ntools: Read, Grep, Bash\nmodel: sonnet\ncolor: blue\n---\nYou are a probe. Keep ''' and \"\"\" and \\ intact.\n";
  await publishActive(admin, { type: "agent", files: [{ path: "quirky-agent.md", content_base64: b64(agent) }] }, "agent", "quirky-agent");
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
  // Negative case: the clients' real home directories are untouched.
  for (const dir of [join(homedir(), ".codex", "skills"), join(homedir(), ".config", "opencode", "skills"), join(homedir(), ".qwen", "skills"), join(homedir(), ".config", "opencode", "agents"), join(homedir(), ".qwen", "agents")]) {
    for (const m of MARKERS) assert.ok(!existsSync(join(dir, m)) && !existsSync(join(dir, `${m}.md`)), `the test wrote ${m} into the real ${dir}`);
  }
});

test("Codex: debug prompt-input sees the project and user skill; the agent is TOML; after uninstall the skill is gone", { skip: CLIENTS.codex ? false : "codex not found" }, () => {
  const ctx = sandbox("codex");
  installAll("codex", ctx);
  const seen = run("codex", ["debug", "prompt-input", "hi"], ctx);
  assert.ok(!seen.error, String(seen.error));
  assert.ok(seen.out.includes("pdf-tools"), `Codex does not see the project skill:\n${seen.out.slice(0, 2000)}`);
  assert.ok(seen.out.includes("rt-user-skill"), "Codex does not see the user skill (~/.codex/skills)");
  const toml = parseToml(readFileSync(join(ctx.proj, ".codex", "agents", "quirky-agent.toml"), "utf8"));
  assert.deepEqual(Object.keys(toml).sort(), ["description", "developer_instructions", "name"]);

  sf(["uninstall", "skill/pdf-tools", "--runtime", "codex"], ctx);
  const after = run("codex", ["debug", "prompt-input", "hi"], ctx);
  assert.ok(!after.out.includes("pdf-tools"), "Codex still sees the removed skill");
});

test("OpenCode: debug skill and agent list see what was installed; configuration is valid", { skip: CLIENTS.opencode ? false : "opencode not found" }, () => {
  const ctx = sandbox("opencode");
  installAll("opencode", ctx);
  const skills = run("opencode", ["debug", "skill"], ctx);
  assert.ok(!/Configuration is invalid/i.test(skills.out), `OpenCode rejected the configuration:\n${skills.out}`);
  assert.ok(skills.out.includes("pdf-tools"), `OpenCode does not see the project skill:\n${skills.out.slice(0, 2000)}`);
  assert.ok(skills.out.includes("rt-user-skill"), "OpenCode does not see the user skill (~/.config/opencode/skills)");
  const agents = run("opencode", ["agent", "list"], ctx);
  assert.ok(!/Configuration is invalid/i.test(agents.out), agents.out);
  assert.match(agents.out, /quirky-agent \(subagent\)/, agents.out);
});

test("Qwen Code: qwen serve serves skills of both scopes and the agent", { skip: CLIENTS.qwen ? false : "qwen not found" }, async () => {
  const ctx = sandbox("qwen");
  installAll("qwen", ctx);
  const c = CLIENTS.qwen;
  const child = spawn(c.cmd, [...c.pre, "serve", "--port", "0", "--no-web", "--workspace", ctx.proj], {
    cwd: ctx.proj,
    env: homeEnv(ctx.home),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const killer = setTimeout(() => child.kill(), CALL_TIMEOUT_MS);
  try {
    const url = await new Promise((resolve, reject) => {
      let log = "";
      const onData = (d) => {
        log += d;
        const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(log);
        if (m) resolve(m[1]);
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("exit", (code) => reject(new Error(`qwen serve exited ${code}: ${log}`)));
    });
    const ws = encodeURIComponent(ctx.proj);
    const skills = await (await fetch(`${url}/workspaces/${ws}/skills`)).json();
    const byName = Object.fromEntries(skills.skills.map((s) => [s.name, s]));
    assert.equal(byName["pdf-tools"]?.level, "project", JSON.stringify(skills).slice(0, 2000));
    assert.equal(byName["rt-user-skill"]?.level, "user", "Qwen Code does not see the user skill (~/.qwen/skills)");
    const agents = await (await fetch(`${url}/workspaces/${ws}/agents`)).json();
    const qa = agents.agents.find((a) => a.name === "quirky-agent");
    assert.ok(qa, JSON.stringify(agents));
    assert.equal(qa.level, "project");
  } finally {
    clearTimeout(killer);
    child.kill();
  }
});

// The OpenCode native-format import fixture (tests/fixtures/agent-clients/opencode) is real —
// the client itself lists it. The Codex and Qwen Code TOML formats are not listed by the clients without a model.
test("OpenCode: the import fixture agent/planner.md is accepted by the client", { skip: CLIENTS.opencode ? false : "opencode not found" }, () => {
  const ctx = sandbox("opencode-native");
  mkdirSync(join(ctx.proj, ".opencode", "agent"), { recursive: true });
  cpSync(join(ROOT, "tests", "fixtures", "agent-clients", "opencode", "agent", "planner.md"), join(ctx.proj, ".opencode", "agent", "planner.md"));
  const agents = run("opencode", ["agent", "list"], ctx);
  assert.ok(!/Configuration is invalid/i.test(agents.out), agents.out);
  assert.match(agents.out, /planner \(subagent\)/, agents.out);
});
