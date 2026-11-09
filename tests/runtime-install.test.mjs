// Installing artifacts for runtimes (Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Qwen Code, Devin, Reckon): skill paths by
// the directories the clients read themselves (verified 15.10.2026), command translation (Gemini TOML and Qwen Code
// with {{args}}, OpenCode/Cursor markdown), agent translation (Codex TOML, OpenCode and Cursor — trimmed frontmatter,
// Qwen Code — as is), refusal for unsupported combinations, hooks only as a plugin, lock in the runtime's base
// directory, uninstall.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

function cli(args, { cwd, home } = {}) {
  return new Promise((resolve) => {
    const h = home ?? join(work, "home");
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: cwd ?? work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), SKILLFORGE_URL: base, SKILLFORGE_TOKEN: undefined, NO_COLOR: "1", HOME: h, USERPROFILE: h },
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

test("agent: Claude Code and Qwen Code — as is; Codex — TOML; OpenCode and Cursor — trimmed frontmatter with a warning", async () => {
  const proj = newProject("agents");
  const published = readFileSync(join(FIXTURES, "agent-executor", "handoff-executor.md"), "utf8");
  for (const [runtime, dir] of [["claude-code", ".claude"], ["qwen", ".qwen"]]) {
    const r = await cli(["install", "agent/handoff-executor", "--runtime", runtime], { cwd: proj });
    assert.equal(r.code, 0, `${runtime}: ${r.err}`);
    assert.equal(readFileSync(join(proj, dir, "agents", "handoff-executor.md"), "utf8"), published, `${runtime}: agent file was changed`);
  }

  const cx = await cli(["install", "agent/quirky-agent", "--runtime", "codex"], { cwd: proj });
  assert.equal(cx.code, 0, cx.err);
  const toml = parseToml(readFileSync(join(proj, ".codex", "agents", "quirky-agent.toml"), "utf8"));
  assert.deepEqual(Object.keys(toml).sort(), ["description", "developer_instructions", "name"], "Codex: exactly three keys");
  assert.equal(toml.name, "quirky-agent");
  assert.equal(toml.description, QUIRKY_DESCRIPTION);
  assert.equal(toml.developer_instructions, AGENT_BODY, "Codex: body character by character");
  for (const key of ["tools", "model", "color"]) assert.ok(cx.err.includes(key), `Codex: warning without ${key}: ${cx.err}`);
  const lockCx = JSON.parse(readFileSync(join(proj, ".codex", ".skillforge-lock.json"), "utf8"));
  assert.deepEqual(Object.keys(lockCx.artifacts["agent/quirky-agent"].files), ["agents/quirky-agent.toml"], "lock: actual path");

  const oc = await cli(["install", "agent/quirky-agent", "--runtime", "opencode"], { cwd: proj });
  assert.equal(oc.code, 0, oc.err);
  const ocMd = splitMd(readFileSync(join(proj, ".opencode", "agents", "quirky-agent.md"), "utf8"));
  assert.deepEqual(ocMd.fm, { description: QUIRKY_DESCRIPTION, mode: "subagent" });
  assert.equal(ocMd.body, AGENT_BODY);
  assert.match(oc.err, /warning: agent quirky-agent: dropped .*not supported by opencode/);
  for (const key of ["name", "tools", "model", "color"]) assert.ok(oc.err.includes(key), `OpenCode: warning without ${key}`);

  const cu = await cli(["install", "agent/quirky-agent", "--runtime", "cursor"], { cwd: proj });
  assert.equal(cu.code, 0, cu.err);
  const cuMd = splitMd(readFileSync(join(proj, ".cursor", "agents", "quirky-agent.md"), "utf8"));
  assert.deepEqual(cuMd.fm, { name: "quirky-agent", description: QUIRKY_DESCRIPTION });
  assert.equal(cuMd.body, AGENT_BODY);
  for (const key of ["tools", "model", "color"]) assert.ok(cu.err.includes(key), `Cursor: warning without ${key}`);

  const un = await cli(["uninstall", "agent/quirky-agent", "--runtime", "codex"], { cwd: proj });
  assert.equal(un.code, 0, un.err);
  assert.ok(!existsSync(join(proj, ".codex", "agents", "quirky-agent.toml")), "uninstall removed .toml");

  for (const runtime of ["gemini", "devin", "reckon"]) {
    const no = await cli(["install", "agent/handoff-executor", "--runtime", runtime], { cwd: proj });
    assert.equal(no.code, 1, `${runtime}: ${no.code}`);
    assert.match(no.err, /not supported/i);
  }
  assert.ok(!existsSync(join(proj, ".gemini", "agents")) && !existsSync(join(proj, ".agents")) && !existsSync(join(proj, ".reckon")), "refusal writes no files");
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
