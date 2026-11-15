// rule-artifacts: installing a rule. Claude Code gets .claude/rules/<name>.md byte for byte (project and user scope);
// Cursor gets .cursor/rules/<name>.mdc with description/globs/alwaysApply; Codex, Gemini CLI and Qwen Code get a block in
// their shared file (rules-block); Devin and Reckon refuse without writing files;
// a rule never appears in the Claude Code marketplace; uninstall removes the file and the lock entry.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const SCOPED = `---\nname: api-style\ndescription: Style of the API handlers.\npaths:\n  - "src/api/**/*.ts"\n  - "tests/api/**"\n---\n\nValidate input at the boundary and return typed errors.\n`;
const ALWAYS = `---\nname: no-secrets-in-logs\ndescription: Keeps secrets out of logs.\n---\n\nNever write secrets, tokens or passwords to logs.\n`;
let srv;
let admin;
let work;

function cli(args, { cwd, home } = {}) {
  return new Promise((resolve) => {
    const h = home ?? join(work, "home");
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: cwd ?? work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), SKILLFORGE_URL: srv.base, SKILLFORGE_TOKEN: undefined, NO_COLOR: "1", HOME: h, USERPROFILE: h },
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

async function publishActive(name, text) {
  const p = await api(srv.base, "POST", "/api/v1/artifacts", { type: "rule", files: [{ path: `rules/${name}.md`, content_base64: Buffer.from(text).toString("base64") }] }, { cookie: admin.cookie });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const t = await api(srv.base, "POST", `/api/v1/artifacts/rule/${name}/transitions`, { to: "active", reason: "rule install test" }, { cookie: admin.cookie });
  assert.equal(t.status, 200, JSON.stringify(t.data));
}

const project = (name) => {
  const d = join(work, name);
  mkdirSync(d, { recursive: true });
  return d;
};
const lock = (dir) => JSON.parse(readFileSync(join(dir, ".skillforge-lock.json"), "utf8"));

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-rule-install-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  work = mkdtempSync(join(tmpdir(), "skillforge-rule-install-work-"));
  mkdirSync(join(work, "home"), { recursive: true });
  await publishActive("api-style", SCOPED);
  await publishActive("no-secrets-in-logs", ALWAYS);
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("Claude Code: .claude/rules/<name>.md byte for byte, in the lock; user scope in the home directory", async () => {
  const p = project("claude");
  const r = await cli(["install", "rule/api-style", "--runtime", "claude-code"], { cwd: p });
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(readFileSync(join(p, ".claude", "rules", "api-style.md"), "utf8"), SCOPED);
  assert.ok(lock(join(p, ".claude")).artifacts["rule/api-style"].files["rules/api-style.md"]);

  const home = join(work, "home-user");
  mkdirSync(home, { recursive: true });
  const u = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "claude-code", "--scope", "user"], { cwd: p, home });
  assert.equal(u.code, 0, u.err + u.out);
  assert.equal(readFileSync(join(home, ".claude", "rules", "no-secrets-in-logs.md"), "utf8"), ALWAYS);
});

test("Cursor: .cursor/rules/<name>.mdc with globs and alwaysApply; no .md and no Claude files", async () => {
  const p = project("cursor");
  const scoped = await cli(["install", "rule/api-style", "--runtime", "cursor"], { cwd: p });
  assert.equal(scoped.code, 0, scoped.err + scoped.out);
  const mdc = readFileSync(join(p, ".cursor", "rules", "api-style.mdc"), "utf8");
  assert.match(mdc, /^---\ndescription: Style of the API handlers\.\nglobs: src\/api\/\*\*\/\*\.ts,tests\/api\/\*\*\nalwaysApply: false\n---\n/);
  assert.ok(mdc.endsWith("Validate input at the boundary and return typed errors.\n"));
  const always = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "cursor"], { cwd: p });
  assert.equal(always.code, 0, always.err + always.out);
  assert.match(readFileSync(join(p, ".cursor", "rules", "no-secrets-in-logs.mdc"), "utf8"), /\nalwaysApply: true\n/);
  assert.deepEqual(readdirSync(join(p, ".cursor", "rules")).sort(), ["api-style.mdc", "no-secrets-in-logs.mdc"]);
  assert.equal(existsSync(join(p, ".claude")), false);
  const user = await cli(["install", "rule/api-style", "--runtime", "cursor", "--scope", "user"], { cwd: p });
  assert.notEqual(user.code, 0, "Cursor user rules are not files");
});

// opencode-rules: OpenCode reads rules from the files listed in `instructions` of its config, so the
// rule goes to .opencode/rules/<name>.md and the config gets the line `.opencode/rules/*.md` once.
const GLOB = ".opencode/rules/*.md";
const jsonc = (text) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));

test("OpenCode, no config: .opencode/rules/<name>.md byte for byte, in the lock, and a new opencode.json with the glob", async () => {
  const p = project("opencode-fresh");
  const r = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "opencode"], { cwd: p });
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(readFileSync(join(p, ".opencode", "rules", "no-secrets-in-logs.md"), "utf8"), ALWAYS);
  assert.ok(lock(join(p, ".opencode")).artifacts["rule/no-secrets-in-logs"].files["rules/no-secrets-in-logs.md"]);
  assert.deepEqual(JSON.parse(readFileSync(join(p, "opencode.json"), "utf8")).instructions, [GLOB]);
  assert.equal(existsSync(join(p, ".claude")), false);
});

test("OpenCode, existing opencode.jsonc: comments and keys kept, the glob added once; a path rule warns", async () => {
  const p = project("opencode-jsonc");
  const before = `{\n  // team config\n  "$schema": "https://opencode.ai/config.json",\n  "mcp": { "skillforge": { "type": "local", "command": ["node", "mcp.js"] } },\n  "instructions": ["CONTRIBUTING.md"],\n}\n`;
  writeFileSync(join(p, "opencode.jsonc"), before);
  const always = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "opencode"], { cwd: p });
  assert.equal(always.code, 0, always.err + always.out);
  const scoped = await cli(["install", "rule/api-style", "--runtime", "opencode"], { cwd: p });
  assert.equal(scoped.code, 0, scoped.err + scoped.out);
  assert.match(scoped.err, /api-style[\s\S]*(paths|every|always)/i, "a path rule warns that OpenCode loads it always");
  assert.doesNotMatch(always.err, /paths/i, "a rule without paths does not warn");
  assert.equal(readFileSync(join(p, ".opencode", "rules", "api-style.md"), "utf8"), SCOPED);
  const sync = await cli(["sync", "--type", "rule", "--runtime", "opencode"], { cwd: p });
  assert.equal(sync.code, 0, sync.err + sync.out);
  const text = readFileSync(join(p, "opencode.jsonc"), "utf8");
  assert.ok(text.includes("// team config"), text);
  const cfg = jsonc(text);
  assert.deepEqual(cfg.instructions, ["CONTRIBUTING.md", GLOB]);
  assert.equal(cfg.mcp.skillforge.type, "local");
  assert.equal(existsSync(join(p, "opencode.json")), false, "a second config was created");
});

test("OpenCode: instructions already in .opencode/opencode.json get the glob there, no root config is made", async () => {
  const p = project("opencode-dotdir");
  mkdirSync(join(p, ".opencode"), { recursive: true });
  writeFileSync(join(p, ".opencode", "opencode.json"), `{\n  "instructions": []\n}\n`);
  const r = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "opencode"], { cwd: p });
  assert.equal(r.code, 0, r.err + r.out);
  assert.deepEqual(JSON.parse(readFileSync(join(p, ".opencode", "opencode.json"), "utf8")).instructions, [GLOB]);
  assert.equal(existsSync(join(p, "opencode.json")), false);
  assert.equal(existsSync(join(p, "opencode.jsonc")), false);
});

test("OpenCode: an unreadable config refuses before writing; user scope refuses; uninstall keeps the glob", async () => {
  const broken = project("opencode-broken");
  writeFileSync(join(broken, "opencode.json"), `{ "instructions": [ \n`);
  const r = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "opencode"], { cwd: broken });
  assert.equal(r.code, 1, r.err + r.out);
  assert.match(r.err + r.out, /opencode\.json/);
  assert.ok((r.err + r.out).includes(GLOB), "the message names the line to add by hand");
  assert.equal(existsSync(join(broken, ".opencode", "rules")), false);
  assert.equal(readFileSync(join(broken, "opencode.json"), "utf8"), `{ "instructions": [ \n`);

  const p = project("opencode-user");
  const user = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "opencode", "--scope", "user"], { cwd: p });
  assert.equal(user.code, 1, user.err + user.out);
  assert.equal(existsSync(join(work, "home", ".config", "opencode", "rules")), false);

  const u = project("opencode-uninstall");
  assert.equal((await cli(["install", "rule/no-secrets-in-logs", "--runtime", "opencode"], { cwd: u })).code, 0);
  const un = await cli(["uninstall", "rule/no-secrets-in-logs", "--runtime", "opencode"], { cwd: u });
  assert.equal(un.code, 0, un.err + un.out);
  assert.equal(existsSync(join(u, ".opencode", "rules", "no-secrets-in-logs.md")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(u, "opencode.json"), "utf8")).instructions, [GLOB]);
});

// rules-block: Codex, Gemini CLI and Qwen Code read rules from one shared file in the project root. The rule is kept
// in .<agent>/skillforge/rules/<name>.md (in the lock), and the shared file gets one SkillForge block between its own
// markers, built from the installed rules. A person's text and the sdlc block outside it stay byte for byte.
const START = "<!-- skillforge:rules:start -->";
const END = "<!-- skillforge:rules:end -->";
const SDLC = `<!-- sdlc:rules:start -->\n## Process rules (sdlc)\n\n- Run the tests before a commit.\n<!-- sdlc:rules:end -->\n`;
const HUMAN = `# Project\n\nUse pnpm, not npm.\n\n${SDLC}`;
const starts = (text) => text.split(/\r?\n/).filter((l) => l === START).length;
const read = (...parts) => readFileSync(join(...parts), "utf8");

test("Codex, no AGENTS.md: the rule copy in .codex/skillforge/rules and the lock, a new AGENTS.md with one block", async () => {
  const p = project("codex-fresh");
  const r = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "codex"], { cwd: p });
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(read(p, ".codex", "skillforge", "rules", "no-secrets-in-logs.md"), ALWAYS);
  assert.ok(lock(join(p, ".codex")).artifacts["rule/no-secrets-in-logs"].files["skillforge/rules/no-secrets-in-logs.md"]);
  const agents = read(p, "AGENTS.md");
  assert.equal(starts(agents), 1, agents);
  assert.ok(agents.startsWith(START), agents);
  assert.ok(agents.includes(`${END}\n`), agents);
  assert.ok(agents.includes("### no-secrets-in-logs"), agents);
  assert.ok(agents.includes("Never write secrets, tokens or passwords to logs."), agents);
  assert.ok(!agents.includes("description: Keeps"), "frontmatter is not in the block");
  assert.equal(existsSync(join(p, ".codex", "rules")), false, ".codex/rules belongs to Codex command rules");
  assert.equal(existsSync(join(p, "GEMINI.md")), false);
});

test("AGENTS.md with a person's text and the sdlc block: both kept byte for byte, sync is idempotent, uninstall restores the file", async () => {
  const p = project("codex-shared");
  writeFileSync(join(p, "AGENTS.md"), HUMAN);
  for (const name of ["no-secrets-in-logs", "api-style"]) {
    const r = await cli(["install", `rule/${name}`, "--runtime", "codex"], { cwd: p });
    assert.equal(r.code, 0, r.err + r.out);
  }
  const text = read(p, "AGENTS.md");
  assert.ok(text.startsWith(HUMAN), text);
  assert.equal(starts(text), 1, text);
  assert.ok(text.indexOf("### api-style") > 0 && text.indexOf("### api-style") < text.indexOf("### no-secrets-in-logs"), "rules by name");
  assert.ok(text.includes("`src/api/**/*.ts`") && text.includes("`tests/api/**`"), "a path rule names its patterns");
  const sync = await cli(["sync", "--type", "rule", "--runtime", "codex"], { cwd: p });
  assert.equal(sync.code, 0, sync.err + sync.out);
  assert.equal(read(p, "AGENTS.md"), text, "sync with nothing new does not change the file");
  for (const name of ["no-secrets-in-logs", "api-style"]) {
    const u = await cli(["uninstall", `rule/${name}`, "--runtime", "codex"], { cwd: p });
    assert.equal(u.code, 0, u.err + u.out);
  }
  assert.equal(read(p, "AGENTS.md"), HUMAN, "uninstalling every rule gives the file back");
  assert.equal(lock(join(p, ".codex")).artifacts["rule/api-style"], undefined);
  assert.equal(existsSync(join(p, ".codex", "skillforge", "rules", "api-style.md")), false);
});

test("a CRLF AGENTS.md gets a CRLF block and comes back byte for byte", async () => {
  const p = project("codex-crlf");
  const crlf = HUMAN.replace(/\n/g, "\r\n");
  writeFileSync(join(p, "AGENTS.md"), crlf);
  assert.equal((await cli(["install", "rule/api-style", "--runtime", "codex"], { cwd: p })).code, 0);
  const text = read(p, "AGENTS.md");
  assert.ok(text.startsWith(crlf));
  assert.doesNotMatch(text, /[^\r]\n/, "a bare LF in a CRLF file");
  const again = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "codex"], { cwd: p });
  assert.equal(again.code, 0, `a CRLF block is not a hand edit: ${again.err}${again.out}`);
  for (const name of ["api-style", "no-secrets-in-logs"]) {
    assert.equal((await cli(["uninstall", `rule/${name}`, "--runtime", "codex"], { cwd: p })).code, 0);
  }
  assert.equal(read(p, "AGENTS.md"), crlf);
});

test("Gemini CLI and Qwen Code: the block goes to GEMINI.md and QWEN.md, no AGENTS.md", async () => {
  const p = project("gemini-qwen");
  for (const [runtime, dir, file] of [["gemini", ".gemini", "GEMINI.md"], ["qwen", ".qwen", "QWEN.md"]]) {
    const r = await cli(["install", "rule/api-style", "--runtime", runtime], { cwd: p });
    assert.equal(r.code, 0, `${runtime}: ${r.err}${r.out}`);
    assert.equal(read(p, dir, "skillforge", "rules", "api-style.md"), SCOPED);
    const text = read(p, file);
    assert.equal(starts(text), 1, text);
    assert.ok(text.includes("### api-style") && text.includes("Validate input at the boundary"), text);
    assert.ok(text.includes(`--runtime ${runtime}`), "the managing note names the sync command for this agent");
  }
  assert.equal(existsSync(join(p, "AGENTS.md")), false);
});

test("a hand edit inside the block refuses install and uninstall with code 5 before any write; --force rebuilds the block", async () => {
  const p = project("codex-hand-edit");
  assert.equal((await cli(["install", "rule/no-secrets-in-logs", "--runtime", "codex"], { cwd: p })).code, 0);
  const edited = read(p, "AGENTS.md").replace("Never write secrets", "Never ever write secrets");
  writeFileSync(join(p, "AGENTS.md"), edited);
  const lockBefore = read(p, ".codex", ".skillforge-lock.json");

  const r = await cli(["install", "rule/api-style", "--runtime", "codex"], { cwd: p });
  assert.equal(r.code, 5, r.err + r.out);
  assert.match(r.err + r.out, /AGENTS\.md/);
  assert.match(r.err + r.out, /--force/);
  assert.equal(read(p, "AGENTS.md"), edited);
  assert.equal(read(p, ".codex", ".skillforge-lock.json"), lockBefore);
  assert.equal(existsSync(join(p, ".codex", "skillforge", "rules", "api-style.md")), false);

  const u = await cli(["uninstall", "rule/no-secrets-in-logs", "--runtime", "codex"], { cwd: p });
  assert.equal(u.code, 5, u.err + u.out);
  assert.equal(read(p, "AGENTS.md"), edited);
  assert.ok(existsSync(join(p, ".codex", "skillforge", "rules", "no-secrets-in-logs.md")));

  const f = await cli(["install", "rule/api-style", "--runtime", "codex", "--force"], { cwd: p });
  assert.equal(f.code, 0, f.err + f.out);
  const text = read(p, "AGENTS.md");
  assert.ok(!text.includes("Never ever"), "the hand edit is replaced");
  assert.ok(text.includes("### api-style") && text.includes("### no-secrets-in-logs"), text);
});

test("a deleted block comes back on sync; the last rule uninstalled removes the AGENTS.md it created", async () => {
  const p = project("codex-last");
  assert.equal((await cli(["install", "rule/no-secrets-in-logs", "--runtime", "codex"], { cwd: p })).code, 0);
  rmSync(join(p, "AGENTS.md"));
  const sync = await cli(["sync", "--type", "rule", "--runtime", "codex"], { cwd: p });
  assert.equal(sync.code, 0, sync.err + sync.out);
  assert.ok(read(p, "AGENTS.md").includes("### no-secrets-in-logs"), "sync restores the block");
  for (const name of ["api-style", "no-secrets-in-logs"]) {
    const u = await cli(["uninstall", `rule/${name}`, "--runtime", "codex"], { cwd: p });
    assert.equal(u.code, 0, u.err + u.out);
  }
  assert.equal(existsSync(join(p, "AGENTS.md")), false, "an AGENTS.md with nothing left is removed");
  assert.equal(existsSync(join(p, ".codex", "skillforge", "rules", "no-secrets-in-logs.md")), false);
});

test("a rule for both Codex and an agent that also reads AGENTS.md warns about the double; the other agent's uninstall leaves the block", async () => {
  const p = project("codex-double");
  assert.equal((await cli(["install", "rule/no-secrets-in-logs", "--runtime", "opencode"], { cwd: p })).code, 0);
  const codex = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "codex"], { cwd: p });
  assert.equal(codex.code, 0, codex.err + codex.out);
  assert.match(codex.err, /opencode/i);
  assert.match(codex.err, /AGENTS\.md/);
  assert.match(codex.err, /twice/i);

  assert.equal((await cli(["install", "rule/api-style", "--runtime", "codex"], { cwd: p })).code, 0);
  const qwen = await cli(["install", "rule/api-style", "--runtime", "qwen"], { cwd: p });
  assert.equal(qwen.code, 0, qwen.err + qwen.out);
  assert.match(qwen.err, /codex/i, "the warning works the other way too");
  assert.match(qwen.err, /twice/i);
  const lone = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "gemini"], { cwd: p });
  assert.equal(lone.code, 0, lone.err + lone.out);
  assert.doesNotMatch(lone.err, /twice/i, "Gemini CLI does not read AGENTS.md");

  const agents = read(p, "AGENTS.md");
  assert.equal((await cli(["uninstall", "rule/no-secrets-in-logs", "--runtime", "opencode"], { cwd: p })).code, 0);
  assert.equal(read(p, "AGENTS.md"), agents, "uninstalling for OpenCode does not touch the Codex block");
});

test("an AGENTS.md over 32 KiB warns about the Codex limit; GEMINI.md does not", async () => {
  const big = `# Big\n\n${"x".repeat(33 * 1024)}\n`;
  const p = project("codex-big");
  writeFileSync(join(p, "AGENTS.md"), big);
  writeFileSync(join(p, "GEMINI.md"), big);
  const codex = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "codex"], { cwd: p });
  assert.equal(codex.code, 0, codex.err + codex.out);
  assert.match(codex.err, /32 KiB/);
  assert.match(codex.err, /project_doc_max_bytes/);
  const gemini = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "gemini"], { cwd: p });
  assert.equal(gemini.code, 0, gemini.err + gemini.out);
  assert.doesNotMatch(gemini.err, /32 KiB/);
});

test("broken markers refuse with code 1 and write nothing; user scope refuses", async () => {
  for (const [name, text] of [
    ["codex-two-starts", `${START}\nA\n${START}\nB\n${END}\n`],
    ["codex-no-end", `# Project\n\n${START}\nA\n`],
  ]) {
    const p = project(name);
    writeFileSync(join(p, "AGENTS.md"), text);
    const r = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "codex"], { cwd: p });
    assert.equal(r.code, 1, `${name}: ${r.err}${r.out}`);
    assert.match(r.err + r.out, /AGENTS\.md/);
    assert.match(r.err + r.out, /marker/i, "the message is about the markers, not a refusal of the agent");
    assert.equal(read(p, "AGENTS.md"), text);
    assert.equal(existsSync(join(p, ".codex", "skillforge")), false, `${name}: the rule copy was written`);
  }
  const home = join(work, "home-codex-user");
  mkdirSync(home, { recursive: true });
  const p = project("codex-user");
  const user = await cli(["install", "rule/no-secrets-in-logs", "--runtime", "codex", "--scope", "user"], { cwd: p, home });
  assert.equal(user.code, 1, user.err + user.out);
  assert.equal(existsSync(join(home, ".codex", "AGENTS.md")), false);
  assert.equal(existsSync(join(home, ".codex", "skillforge")), false);
});

test("an agent without a rules file refuses and writes nothing", async () => {
  for (const [runtime, dir] of [["devin", ".agents"], ["reckon", ".reckon"]]) {
    const p = project(`refuse-${runtime}`);
    const r = await cli(["install", "rule/api-style", "--runtime", runtime], { cwd: p });
    assert.equal(r.code, 1, `${runtime}: ${r.err}${r.out}`);
    assert.match(r.err + r.out, /rules are not supported/);
    assert.equal(existsSync(join(p, dir)), false, `${runtime}: files were written`);
    assert.equal(existsSync(join(p, "AGENTS.md")), false, `${runtime}: AGENTS.md was written`);
  }
});

// Found in the manual check (rule-artifacts 5.2): the CLI sent a single .md under its base name, so a file in rules/
// published without --type became a command, although the type is detected by the rules/ folder.
test("skillforge publish without --type: a file in rules/ and a folder with rules/<name>.md are rules; commands/ stays a command", async () => {
  const token = (await api(srv.base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: admin.cookie })).data.token;
  const src = project("publish-src");
  const write = (rel, name) => {
    mkdirSync(join(src, rel), { recursive: true });
    const file = join(src, rel, `${name}.md`);
    writeFileSync(file, `---\nname: ${name}\ndescription: Publish type test.\n---\n\nKeep handlers small.\n`);
    return file;
  };
  const cases = [
    [write("file/rules", "pub-rule-file"), "rule"],
    [(write("harvest/rules", "pub-rule-dir"), join(src, "harvest")), "rule"],
    [write("cmd/commands", "pub-command"), "command"],
  ];
  for (const [path, type] of cases) {
    const r = await cli(["publish", path, "--version", "1.0.0", "--token", token, "--json"]);
    assert.equal(r.code, 0, r.err + r.out);
    assert.equal(JSON.parse(r.out).artifact.type, type, path);
  }
  const file = await api(srv.base, "GET", "/api/v1/artifacts/rule/pub-rule-dir/versions/1.0.0/files/rules/pub-rule-dir.md", undefined, { cookie: admin.cookie });
  assert.equal(file.status, 200, "the rule's file is rules/<name>.md");
});

test("a rule is not in the Claude Code marketplace", async () => {
  const m = await api(srv.base, "GET", "/marketplace.json");
  assert.equal(m.status, 200);
  assert.ok(!JSON.stringify(m.data).includes("api-style"), "a rule is listed as a plugin");
});

test("uninstall removes the rule file and its lock entry", async () => {
  const p = project("uninstall");
  assert.equal((await cli(["install", "rule/api-style", "--runtime", "cursor"], { cwd: p })).code, 0);
  const r = await cli(["uninstall", "rule/api-style", "--runtime", "cursor"], { cwd: p });
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(existsSync(join(p, ".cursor", "rules", "api-style.mdc")), false);
  assert.equal(lock(join(p, ".cursor")).artifacts["rule/api-style"], undefined);
});
