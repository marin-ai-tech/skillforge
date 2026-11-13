// rule-artifacts: installing a rule. Claude Code gets .claude/rules/<name>.md byte for byte (project and user scope);
// Cursor gets .cursor/rules/<name>.mdc with description/globs/alwaysApply; other agents refuse without writing files;
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

test("an agent without a rules folder refuses, naming its shared file, and writes nothing", async () => {
  for (const [runtime, dir, file] of [["codex", ".codex", "AGENTS.md"], ["gemini", ".gemini", "GEMINI.md"], ["qwen", ".qwen", "QWEN.md"]]) {
    const p = project(`refuse-${runtime}`);
    const r = await cli(["install", "rule/api-style", "--runtime", runtime], { cwd: p });
    assert.equal(r.code, 1, `${runtime}: ${r.err}${r.out}`);
    assert.match(r.err + r.out, new RegExp(file.replace(".", "\\.")));
    assert.equal(existsSync(join(p, dir)), false, `${runtime}: files were written`);
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
