// Installing artifacts for runtimes (Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Qwen Code, Devin, Reckon): skill paths by
// the directories the clients read themselves (verified 15.10.2026), command translation (Gemini TOML and Qwen Code
// with {{args}}, OpenCode/Cursor markdown), agent translation (Codex TOML, OpenCode, Cursor and Qwen Code — trimmed
// frontmatter with the agent's tool restrictions in each runtime's mechanism, agent-restrictions-translation), refusal for unsupported combinations, hooks only as a plugin, lock in the runtime's base
// directory, uninstall.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { startServer, api, login, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let base;
let admin;
let work;

function cli(args, { cwd, home, token } = {}) {
  return new Promise((resolve) => {
    const h = home ?? join(work, "home");
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: cwd ?? work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), SKILLFORGE_URL: base, SKILLFORGE_TOKEN: token, NO_COLOR: "1", HOME: h, USERPROFILE: h },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

async function publishActive(body, type, name) {
  const p = await api(base, "POST", "/api/v1/artifacts", body, { cookie: admin.cookie });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const t = await api(base, "POST", `/api/v1/artifacts/${type}/${name}/transitions`, { to: "active", reason: "runtime test" }, { cookie: admin.cookie });
  assert.equal(t.status, 200);
  return p.data;
}

const newProject = (name) => {
  const d = join(work, name);
  mkdirSync(d, { recursive: true });
  return d;
};

const TOML_ESC = { '"': '"', "\\": "\\", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const unescapeBasic = (s) =>
  s
    .replace(/\\\r?\n\s*/g, "")
    .replace(/\\(["\\bfnrt]|u[0-9a-fA-F]{4})/g, (_, c) => TOML_ESC[c] ?? String.fromCharCode(parseInt(c.slice(1), 16)));

/**
 * Parsing of Gemini command keys: description is a string ("…" or '…'); prompt is a multiline string ("""…""" with
 * escaping or '''…''' literal). Returns DECODED values — the test checks the meaning, not the way it is written.
 */
function parseGeminiToml(text) {
  const basicDesc = /^description\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m.exec(text);
  const litDesc = /^description\s*=\s*'([^']*)'\s*$/m.exec(text);
  const litPrompt = /^prompt\s*=\s*'''\n?([\s\S]*?)'''\s*$/m.exec(text);
  const basicPrompt = /^prompt\s*=\s*"""\n?([\s\S]*?)"""\s*$/m.exec(text);
  return {
    description: basicDesc ? unescapeBasic(basicDesc[1]) : litDesc ? litDesc[1] : null,
    prompt: litPrompt ? litPrompt[1] : basicPrompt ? unescapeBasic(basicPrompt[1]) : null,
  };
}

const AGENT_BODY = "Keep ''' and \"\"\" and a backslash \\ and $ARGUMENTS intact.\nSecond line.\n";
const QUIRKY_DESCRIPTION = "Agent with Claude-only keys and a body that stresses TOML quoting.";
const PLAIN_DESCRIPTION = "Agent with Claude-only keys and no tool restrictions.";
const PLAIN_AGENT = `---
name: plain-agent
description: ${PLAIN_DESCRIPTION}
model: sonnet
color: blue
---
` + AGENT_BODY;

function splitMd(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, `no frontmatter: ${text}`);
  return { fm: parseYaml(m[1]), body: m[2] };
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-runtime-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  work = mkdtempSync(join(tmpdir(), "skillforge-runtime-work-"));
  mkdirSync(join(work, "home"), { recursive: true });
  await publishActive({ type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, "skill", "pdf-tools");
  const cmd = `---\ndescription: Summarizes the given file for a changelog entry.\nargument-hint: <file>\n---\n\nSummarize $ARGUMENTS in one line for the changelog. Keep "quotes" and a backslash \\ intact.\n`;
  await publishActive({ type: "command", files: [{ path: "summarize.md", content_base64: Buffer.from(cmd).toString("base64") }] }, "command", "summarize");
  await publishActive({ type: "agent", files: toB64(loadDir(join(FIXTURES, "agent-executor"))) }, "agent", "handoff-executor");
  const quirky = "---\nname: quirky-agent\ndescription: Agent with Claude-only keys and a body that stresses TOML quoting.\ntools: Read, Grep, Bash\nmodel: sonnet\ncolor: blue\n---\n" + AGENT_BODY;
  await publishActive({ type: "agent", files: [{ path: "quirky-agent.md", content_base64: Buffer.from(quirky).toString("base64") }] }, "agent", "quirky-agent");
  await publishActive({ type: "agent", files: [{ path: "plain-agent.md", content_base64: Buffer.from(PLAIN_AGENT).toString("base64") }] }, "agent", "plain-agent");
  // agent-restrictions-translation: the sdlc roles as the registry stores them, and two agents whose restriction some
  // runtime cannot express.
  const reviewer = await publishActive({ type: "agent", files: toB64(loadDir(join(FIXTURES, "sdlc-reviewer"))) }, "agent", "reviewer");
  await publishActive({ type: "agent", files: toB64(loadDir(join(FIXTURES, "sdlc-developer"))) }, "agent", "developer");
  const noShell = "---\nname: no-shell-agent\ndescription: Reads and searches only.\ntools: [read, grep]\n---\n" + AGENT_BODY;
  await publishActive({ type: "agent", files: [{ path: "no-shell-agent.md", content_base64: Buffer.from(noShell).toString("base64") }] }, "agent", "no-shell-agent");
  const readonlyOnly = "---\nname: readonly-only\ndescription: Forbids editing only with readonly.\nreadonly: true\n---\n" + AGENT_BODY;
  await publishActive({ type: "agent", files: [{ path: "readonly-only.md", content_base64: Buffer.from(readonlyOnly).toString("base64") }] }, "agent", "readonly-only");
  const pack = await api(base, "POST", "/api/v1/packs", {
    name: "sdlc-team",
    version: "1.0.0",
    title: "sdlc team",
    description: "The reviewer role of an sdlc team.",
    roles: [{ name: "reviewer", description: "Reviews changes", items: [{ type: "agent", name: "reviewer", version: reviewer.version.version }] }],
  }, { cookie: admin.cookie });
  assert.equal(pack.status, 201, JSON.stringify(pack.data));
  await publishActive({ type: "hook", name: "destructive-guard", files: toB64(loadDir(join(FIXTURES, "hook-guard"))) }, "hook", "destructive-guard");
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("skill: path by runtime and scope; SKILL.md unchanged; lock in the runtime's base directory", async () => {
  const original = readFileSync(join(FIXTURES, "skill-standard", "pdf-tools", "SKILL.md"), "utf8");
  const cases = [
    ["claude-code", ".claude/skills"],
    ["codex", ".codex/skills"],
    ["devin", ".agents/skills"],
    ["gemini", ".gemini/skills"],
    ["cursor", ".cursor/skills"],
    ["opencode", ".opencode/skills"],
    ["qwen", ".qwen/skills"],
    ["reckon", ".reckon/skills"],
  ];
  for (const [runtime, dir] of cases) {
    const proj = newProject(`skill-${runtime}`);
    const r = await cli(["install", "skill/pdf-tools", "--runtime", runtime], { cwd: proj });
    assert.equal(r.code, 0, `${runtime}: ${r.out}\n${r.err}`);
    const skillMd = join(proj, ...dir.split("/"), "pdf-tools", "SKILL.md");
    assert.ok(existsSync(skillMd), `${runtime}: no ${dir}/pdf-tools/SKILL.md`);
    assert.equal(readFileSync(skillMd, "utf8"), original, `${runtime}: SKILL.md was changed`);
    assert.ok(existsSync(join(proj, ...dir.split("/"), "pdf-tools", "references", "REFERENCE.md")));
    const lockPath = join(proj, dir.split("/")[0], ".skillforge-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    assert.equal(lock.artifacts["skill/pdf-tools"].runtime, runtime, `${runtime}: runtime in lock`);
  }
});

test("user scope: a directory in the runtime's home directory", async () => {
  const home = join(work, "home-user");
  mkdirSync(home, { recursive: true });
  const proj = newProject("user-scope");
  for (const [runtime, dir] of [
    ["codex", ".codex/skills"],
    ["gemini", ".gemini/skills"],
    ["opencode", ".config/opencode/skills"],
    ["qwen", ".qwen/skills"],
    ["claude-code", ".claude/skills"],
  ]) {
    const r = await cli(["install", "skill/pdf-tools", "--runtime", runtime, "--scope", "user"], { cwd: proj, home });
    assert.equal(r.code, 0, `${runtime}: ${r.err}`);
    assert.ok(existsSync(join(home, ...dir.split("/"), "pdf-tools", "SKILL.md")), `${runtime}: no ~/${dir}/pdf-tools`);
  }
  assert.ok(!existsSync(join(proj, ".agents")) && !existsSync(join(proj, ".codex")), "user scope does not write into the project");
  assert.ok(!existsSync(join(home, ".agents")), "Codex 0.158 does not read ~/.agents/skills — nothing is written there");
});

test("command: Gemini — TOML with {{args}}, OpenCode — markdown with a description, Qwen Code — markdown with {{args}}, Cursor — body; Codex and Devin — refusal", async () => {
  const proj = newProject("commands");
  const g = await cli(["install", "command/summarize", "--runtime", "gemini"], { cwd: proj });
  assert.equal(g.code, 0, g.err);
  const toml = parseGeminiToml(readFileSync(join(proj, ".gemini", "commands", "summarize.toml"), "utf8"));
  assert.equal(toml.description, "Summarizes the given file for a changelog entry.");
  assert.ok(toml.prompt && toml.prompt.includes("Summarize {{args}} in one line"), JSON.stringify(toml));
  assert.ok(!toml.prompt.includes("$ARGUMENTS"));
  assert.ok(toml.prompt.includes('Keep "quotes" and a backslash \\ intact.'), "prompt content preserved");

  const o = await cli(["install", "command/summarize", "--runtime", "opencode"], { cwd: proj });
  assert.equal(o.code, 0, o.err);
  const oc = readFileSync(join(proj, ".opencode", "commands", "summarize.md"), "utf8");
  assert.match(oc, /^---\n[\s\S]*description: Summarizes the given file for a changelog entry\.[\s\S]*\n---\n/);
  assert.ok(oc.includes("Summarize $ARGUMENTS in one line"), "OpenCode understands $ARGUMENTS");

  const q = await cli(["install", "command/summarize", "--runtime", "qwen"], { cwd: proj });
  assert.equal(q.code, 0, q.err);
  const qm = splitMd(readFileSync(join(proj, ".qwen", "commands", "summarize.md"), "utf8"));
  assert.deepEqual(qm.fm, { description: "Summarizes the given file for a changelog entry." }, "Qwen Code: frontmatter has only description");
  assert.ok(qm.body.includes("Summarize {{args}} in one line"), qm.body);
  assert.ok(!qm.body.includes("$ARGUMENTS"), "Qwen Code: $ARGUMENTS replaced");
  assert.ok(qm.body.includes('Keep "quotes" and a backslash \\ intact.'), "Qwen Code: body preserved");

  const c = await cli(["install", "command/summarize", "--runtime", "cursor"], { cwd: proj });
  assert.equal(c.code, 0, c.err);
  const cur = readFileSync(join(proj, ".cursor", "commands", "summarize.md"), "utf8");
  assert.ok(!cur.startsWith("---"), "Cursor: no frontmatter");
  assert.ok(cur.includes("Summarize"), cur);

  for (const runtime of ["codex", "devin"]) {
    const r = await cli(["install", "command/summarize", "--runtime", runtime], { cwd: proj });
    assert.equal(r.code, 1, `${runtime}: ${r.code}`);
    assert.match(r.err, /not supported/i);
    assert.match(r.err, /skill/i, "hint: format it as a skill");
  }
});

test("agent without restrictions: Claude Code as is; Qwen Code and Cursor — name + description; Codex — three TOML keys; OpenCode — description + mode", async () => {
  const proj = newProject("agents-plain");
  const cc = await cli(["install", "agent/plain-agent", "--runtime", "claude-code"], { cwd: proj });
  assert.equal(cc.code, 0, cc.err);
  assert.equal(readFileSync(join(proj, ".claude", "agents", "plain-agent.md"), "utf8"), PLAIN_AGENT, "claude-code: as is");
  const qw = await cli(["install", "agent/plain-agent", "--runtime", "qwen"], { cwd: proj });
  assert.equal(qw.code, 0, qw.err);
  assert.deepEqual(splitMd(readFileSync(join(proj, ".qwen", "agents", "plain-agent.md"), "utf8")), {
    fm: { name: "plain-agent", description: PLAIN_DESCRIPTION },
    body: AGENT_BODY,
  });
  const cx = await cli(["install", "agent/plain-agent", "--runtime", "codex"], { cwd: proj });
  assert.equal(cx.code, 0, cx.err);
  const toml = parseToml(readFileSync(join(proj, ".codex", "agents", "plain-agent.toml"), "utf8"));
  assert.deepEqual(Object.keys(toml).sort(), ["description", "developer_instructions", "name"], "Codex: exactly three keys");
  assert.equal(toml.developer_instructions, AGENT_BODY, "Codex: body character by character");
  for (const key of ["model", "color"]) assert.ok(cx.err.includes(key), `Codex: warning without ${key}: ${cx.err}`);
  const lockCx = JSON.parse(readFileSync(join(proj, ".codex", ".skillforge-lock.json"), "utf8"));
  assert.deepEqual(Object.keys(lockCx.artifacts["agent/plain-agent"].files), ["agents/plain-agent.toml"], "lock: actual path");
  assert.equal(lockCx.artifacts["agent/plain-agent"].weaker_restrictions, undefined, "nothing weaker — no lock field");
  const oc = await cli(["install", "agent/plain-agent", "--runtime", "opencode"], { cwd: proj });
  assert.equal(oc.code, 0, oc.err);
  const ocMd = splitMd(readFileSync(join(proj, ".opencode", "agents", "plain-agent.md"), "utf8"));
  assert.deepEqual(ocMd.fm, { description: PLAIN_DESCRIPTION, mode: "subagent" });
  assert.equal(ocMd.body, AGENT_BODY);
  assert.match(oc.err, /warning: agent plain-agent: dropped .*not supported by opencode/);
  const cu = await cli(["install", "agent/plain-agent", "--runtime", "cursor"], { cwd: proj });
  assert.equal(cu.code, 0, cu.err);
  assert.deepEqual(splitMd(readFileSync(join(proj, ".cursor", "agents", "plain-agent.md"), "utf8")).fm, {
    name: "plain-agent",
    description: PLAIN_DESCRIPTION,
  });

  const un = await cli(["uninstall", "agent/plain-agent", "--runtime", "codex"], { cwd: proj });
  assert.equal(un.code, 0, un.err);
  assert.ok(!existsSync(join(proj, ".codex", "agents", "plain-agent.toml")), "uninstall removed .toml");

  for (const runtime of ["gemini", "devin", "reckon"]) {
    const no = await cli(["install", "agent/plain-agent", "--runtime", runtime], { cwd: proj });
    assert.equal(no.code, 1, `${runtime}: ${no.code}`);
    assert.match(no.err, /not supported/i);
  }
  assert.ok(!existsSync(join(proj, ".gemini", "agents")) && !existsSync(join(proj, ".agents")) && !existsSync(join(proj, ".reckon")), "refusal writes no files");
});

// agent-restrictions-translation (#208): `tools: Read, Grep, Bash` forbids editing and network. Each runtime gets the
// restriction in its own mechanism; Cursor cannot forbid network, so it refuses unless --allow-weaker-restrictions.
test("agent with tools: OpenCode permission, Codex read-only sandbox, Qwen disallowedTools; Claude Code as is; Cursor refuses", async () => {
  const proj = newProject("agents-restricted");
  const published = readFileSync(join(FIXTURES, "agent-executor", "handoff-executor.md"), "utf8");
  const cc = await cli(["install", "agent/handoff-executor", "--runtime", "claude-code"], { cwd: proj });
  assert.equal(cc.code, 0, cc.err);
  assert.equal(readFileSync(join(proj, ".claude", "agents", "handoff-executor.md"), "utf8"), published, "claude-code: as is");

  const cx = await cli(["install", "agent/quirky-agent", "--runtime", "codex"], { cwd: proj });
  assert.equal(cx.code, 0, cx.err);
  const toml = parseToml(readFileSync(join(proj, ".codex", "agents", "quirky-agent.toml"), "utf8"));
  assert.deepEqual(Object.keys(toml).sort(), ["description", "developer_instructions", "name", "sandbox_mode", "web_search"]);
  assert.deepEqual([toml.sandbox_mode, toml.web_search], ["read-only", "disabled"]);
  assert.equal(toml.developer_instructions, AGENT_BODY);

  const oc = await cli(["install", "agent/quirky-agent", "--runtime", "opencode"], { cwd: proj });
  assert.equal(oc.code, 0, oc.err);
  const ocMd = splitMd(readFileSync(join(proj, ".opencode", "agents", "quirky-agent.md"), "utf8"));
  assert.deepEqual(ocMd.fm, { description: QUIRKY_DESCRIPTION, mode: "subagent", permission: { edit: "deny", webfetch: "deny" } });
  assert.equal(ocMd.body, AGENT_BODY);

  const qw = await cli(["install", "agent/quirky-agent", "--runtime", "qwen"], { cwd: proj });
  assert.equal(qw.code, 0, qw.err);
  assert.deepEqual(splitMd(readFileSync(join(proj, ".qwen", "agents", "quirky-agent.md"), "utf8")).fm, {
    name: "quirky-agent",
    description: QUIRKY_DESCRIPTION,
    disallowedTools: ["edit", "write_file", "web_fetch", "web_search"],
  });

  const cu = await cli(["install", "agent/quirky-agent", "--runtime", "cursor"], { cwd: proj });
  assert.equal(cu.code, 1, `Cursor cannot forbid network: ${cu.out}\n${cu.err}`);
  assert.match(cu.err, /quirky-agent.*cursor.*network/i);
  assert.match(cu.err, /--allow-weaker-restrictions/);
  assert.ok(!existsSync(join(proj, ".cursor", "agents", "quirky-agent.md")), "refusal writes no agent file");
  const lockPath = join(proj, ".cursor", ".skillforge-lock.json");
  assert.ok(!existsSync(lockPath) || !JSON.parse(readFileSync(lockPath, "utf8")).artifacts["agent/quirky-agent"], "no lock entry");

  const forced = await cli(["install", "agent/quirky-agent", "--runtime", "cursor", "--allow-weaker-restrictions"], { cwd: proj });
  assert.equal(forced.code, 0, forced.err);
  assert.deepEqual(splitMd(readFileSync(join(proj, ".cursor", "agents", "quirky-agent.md"), "utf8")).fm, {
    name: "quirky-agent",
    description: QUIRKY_DESCRIPTION,
    readonly: true,
  });
  assert.match(forced.err, /warning: agent quirky-agent: cursor does not enforce network/);
  assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf8")).artifacts["agent/quirky-agent"].weaker_restrictions, ["network"]);
  const sync = await cli(["sync", "--runtime", "cursor"], { cwd: proj });
  assert.equal(sync.code, 0, `sync repeats the recorded waiver without the flag: ${sync.err}`);
});

test("sdlc reviewer role: install and pack install --role keep it read-only; a restriction the runtime cannot express is refused", async () => {
  const proj = newProject("agents-sdlc");
  const viaInstall = await cli(["install", "agent/reviewer", "--runtime", "opencode"], { cwd: proj });
  assert.equal(viaInstall.code, 0, viaInstall.err);
  assert.deepEqual(splitMd(readFileSync(join(proj, ".opencode", "agents", "reviewer.md"), "utf8")).fm.permission, {
    edit: "deny",
    webfetch: "deny",
  }, "as sdlc writes it: edit and webfetch deny, bash allowed");

  const packProj = newProject("agents-sdlc-pack");
  // pack install reads /api/v1/packs, which needs a signed-in user (method-packs)
  const token = (await api(base, "POST", "/api/v1/me/tokens", { name: "runtime-packs" }, { cookie: admin.cookie })).data.token;
  for (const runtime of ["opencode", "codex", "qwen"]) {
    const r = await cli(["pack", "install", "sdlc-team", "--role", "reviewer", "--runtime", runtime], { cwd: packProj, token });
    assert.equal(r.code, 0, `${runtime}: ${r.err}`);
  }
  assert.deepEqual(splitMd(readFileSync(join(packProj, ".opencode", "agents", "reviewer.md"), "utf8")).fm.permission, { edit: "deny", webfetch: "deny" });
  const toml = parseToml(readFileSync(join(packProj, ".codex", "agents", "reviewer.toml"), "utf8"));
  assert.deepEqual([toml.sandbox_mode, toml.web_search], ["read-only", "disabled"]);
  assert.deepEqual(splitMd(readFileSync(join(packProj, ".qwen", "agents", "reviewer.md"), "utf8")).fm.disallowedTools, ["edit", "write_file", "web_fetch", "web_search"]);

  // negative: the developer role may edit — no edit restriction anywhere
  const dev = await cli(["install", "agent/developer", "--runtime", "opencode"], { cwd: proj });
  assert.equal(dev.code, 0, dev.err);
  assert.deepEqual(splitMd(readFileSync(join(proj, ".opencode", "agents", "developer.md"), "utf8")).fm.permission, { webfetch: "deny" });

  const noShell = await cli(["install", "agent/no-shell-agent", "--runtime", "codex"], { cwd: proj });
  assert.equal(noShell.code, 1, `Codex cannot forbid the shell: ${noShell.err}`);
  assert.match(noShell.err, /no-shell-agent.*codex.*shell/i);
  assert.ok(!existsSync(join(proj, ".codex", "agents", "no-shell-agent.toml")));

  const ro = await cli(["install", "agent/readonly-only", "--runtime", "claude-code"], { cwd: proj });
  assert.equal(ro.code, 1, `Claude Code does not apply readonly: ${ro.err}`);
  assert.match(ro.err, /readonly-only.*claude-code.*edit/i);
  assert.match(ro.err, /tools|disallowedTools/);
  assert.ok(!existsSync(join(proj, ".claude", "agents", "readonly-only.md")));
});
// agent-restrictions-translation, task 3.1: an agent installed by a former CLI (old translation, no `translation` mark
// in the lock) gets its restrictions at the next sync of the same version; a file the person edited is not overwritten.
test("compatibility: sync translates an agent installed by a former CLI again; an edited file is kept (exit code 5)", async () => {
  for (const edited of [false, true]) {
    const proj = newProject(`agents-compat-${edited ? "edited" : "clean"}`);
    const r = await cli(["install", "agent/reviewer", "--runtime", "opencode"], { cwd: proj });
    assert.equal(r.code, 0, r.err);
    const file = join(proj, ".opencode", "agents", "reviewer.md");
    const lockPath = join(proj, ".opencode", ".skillforge-lock.json");
    const current = readFileSync(file, "utf8");
    // What the former CLI wrote: description and mode only, and a lock entry without the translation mark.
    const former = current.replace(/permission:\n(  .*\n)+/, "");
    assert.ok(!former.includes("permission"), former);
    writeFileSync(file, former);
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const entry = lock.artifacts["agent/reviewer"];
    assert.ok(entry.translation, "the new CLI marks its translation");
    delete entry.translation;
    entry.files["agents/reviewer.md"] = createHash("sha256").update(former).digest("hex");
    writeFileSync(lockPath, JSON.stringify(lock, null, 2));
    if (edited) writeFileSync(file, former + "A note of my own.\n");

    const s = await cli(["sync", "--runtime", "opencode"], { cwd: proj });
    const after = readFileSync(file, "utf8");
    if (edited) {
      assert.ok(after.endsWith("A note of my own.\n"), "the edited file is not overwritten");
      assert.notEqual(s.code, 0, `sync reports the local change: ${s.out}\n${s.err}`);
    } else {
      assert.equal(s.code, 0, s.err);
      assert.deepEqual(splitMd(after).fm.permission, { edit: "deny", webfetch: "deny" }, "the restriction arrived");
      assert.ok(JSON.parse(readFileSync(lockPath, "utf8")).artifacts["agent/reviewer"].translation);
    }
  }
});

test("hook — only as a plugin (/plugin install), no files are written", async () => {
  const proj = newProject("hooks");
  const hook = await cli(["install", "hook/destructive-guard", "--runtime", "claude-code"], { cwd: proj });
  assert.equal(hook.code, 1, `${hook.out}\n${hook.err}`);
  assert.match(hook.err, /\/plugin install destructive-guard-hook@/);
  assert.ok(!existsSync(join(proj, ".claude", "hooks")), "non-working hook files are not written");
  const legacy = await cli(["install", "hook/destructive-guard", "--into", join(proj, ".claude")], { cwd: proj });
  assert.equal(legacy.code, 1, "also via --into");
});

test("API: the runtimes table and install.runtimes on the card — a command or a reason", async () => {
  const r = await api(base, "GET", "/api/v1/runtimes");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.items.map((x) => x.id), ["claude-code", "codex", "gemini", "cursor", "opencode", "qwen", "devin", "reckon"]);
  assert.equal(r.data.items.find((x) => x.id === "qwen").label, "Qwen Code");
  for (const x of r.data.items) assert.ok(x.label && Array.isArray(x.scopes) && x.scopes.includes("project"), JSON.stringify(x));
  for (const id of ["devin", "reckon"]) assert.ok(!r.data.items.find((x) => x.id === id).scopes.includes("user"), `${id} has no user scope`);

  const skill = await api(base, "GET", "/api/v1/artifacts/skill/pdf-tools");
  const rs = skill.data.install.runtimes;
  assert.deepEqual(rs.map((x) => x.runtime), ["claude-code", "codex", "gemini", "cursor", "opencode", "qwen", "devin", "reckon"]);
  for (const x of rs) {
    assert.equal(x.supported, true, x.runtime);
    assert.equal(x.command, `skillforge install skill/pdf-tools --runtime ${x.runtime}`);
  }

  const cmd = (await api(base, "GET", "/api/v1/artifacts/command/summarize")).data.install.runtimes;
  const byId = Object.fromEntries(cmd.map((x) => [x.runtime, x]));
  assert.equal(byId.gemini.supported, true);
  assert.equal(byId.codex.supported, false);
  assert.equal(byId.codex.command, null);
  assert.match(byId.codex.reason, /skill/i);

  const hook = Object.fromEntries((await api(base, "GET", "/api/v1/artifacts/hook/destructive-guard")).data.install.runtimes.map((x) => [x.runtime, x]));
  assert.equal(hook["claude-code"].supported, true);
  assert.match(hook["claude-code"].command, /^\/plugin install destructive-guard-hook@/);
  assert.equal(hook.gemini.supported, false);
  assert.ok(hook.gemini.reason);
});

test("sync for a runtime: unsupported artifacts are skipped with a reason, exit code 0", async () => {
  const proj = newProject("sync-codex");
  const s = await cli(["sync", "--runtime", "codex", "--status", "active", "--json"], { cwd: proj });
  assert.equal(s.code, 0, s.out + s.err);
  const summary = JSON.parse(s.out);
  assert.ok(summary.installed.some((x) => x.startsWith("skill/pdf-tools@")), s.out);
  assert.ok(summary.installed.some((x) => x.startsWith("agent/handoff-executor@")), `the agent is installed into Codex: ${s.out}`);
  const skipped = summary.skipped.map((x) => (typeof x === "string" ? x : `${x.artifact} ${x.reason}`)).join("\n");
  for (const key of ["command/summarize", "hook/destructive-guard"]) assert.ok(skipped.includes(key), `no ${key} in skipped: ${skipped}`);
  assert.ok(existsSync(join(proj, ".codex", "skills", "pdf-tools", "SKILL.md")));
  assert.ok(existsSync(join(proj, ".codex", "agents", "handoff-executor.toml")));
  assert.ok(!existsSync(join(proj, ".codex", "hooks")) && !existsSync(join(proj, ".codex", "commands")));
  assert.ok(!existsSync(join(proj, ".agents")), "Codex no longer writes to .agents");
});

test("attack: a link (junction) inside the runtime directory does not let writing and deletion escape it", async () => {
  const proj = newProject("junction");
  const outside = join(work, "outside-target");
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(proj, ".codex"), { recursive: true });
  symlinkSync(outside, join(proj, ".codex", "skills"), "junction");
  const r = await cli(["install", "skill/pdf-tools", "--runtime", "codex"], { cwd: proj });
  assert.equal(r.code, 1, `${r.out}\n${r.err}`);
  assert.deepEqual(readdirSync(outside), [], "write through a link outside .codex");

  const proj2 = newProject("junction-uninstall");
  const ok = await cli(["install", "skill/pdf-tools", "--runtime", "codex"], { cwd: proj2 });
  assert.equal(ok.code, 0, ok.err);
  const outside2 = join(work, "outside-victim");
  mkdirSync(join(outside2, "pdf-tools", "references"), { recursive: true });
  const victim = join(outside2, "pdf-tools", "SKILL.md");
  writeFileSync(victim, "victim");
  rmSync(join(proj2, ".codex", "skills"), { recursive: true, force: true });
  symlinkSync(outside2, join(proj2, ".codex", "skills"), "junction");
  const un = await cli(["uninstall", "skill/pdf-tools", "--runtime", "codex"], { cwd: proj2 });
  assert.equal(un.code, 1, `${un.out}\n${un.err}`);
  assert.ok(existsSync(victim), "uninstall removed a file outside .codex through a link");
});

test("unknown runtime — exit code 1 with a list; uninstall removes from the runtime directory; --into still works", async () => {
  const proj = newProject("misc");
  const bad = await cli(["install", "skill/pdf-tools", "--runtime", "vim"], { cwd: proj });
  assert.equal(bad.code, 1);
  for (const r of ["claude-code", "codex", "gemini", "cursor", "opencode", "qwen", "devin", "reckon"]) assert.ok(bad.err.includes(r), `no ${r} in the hint`);

  const inst = await cli(["install", "skill/pdf-tools", "--runtime", "codex"], { cwd: proj });
  assert.equal(inst.code, 0, inst.err);
  const un = await cli(["uninstall", "skill/pdf-tools", "--runtime", "codex"], { cwd: proj });
  assert.equal(un.code, 0, un.err);
  assert.ok(!existsSync(join(proj, ".codex", "skills", "pdf-tools")), "uninstall removed the skill from .codex/skills");

  const into = join(proj, "custom-claude");
  const legacy = await cli(["install", "skill/pdf-tools", "--into", into], { cwd: proj });
  assert.equal(legacy.code, 0, legacy.err);
  assert.ok(existsSync(join(into, "skills", "pdf-tools", "SKILL.md")), "the old --into behavior is preserved");
});
