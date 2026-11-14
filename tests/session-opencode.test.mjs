// opencode-sessions: `sessions import --harness opencode` reads OpenCode session exports
// (`opencode export <id>`: { info, messages: [{ info, parts }] }, shape taken from OpenCode 1.18.34 in the field test)
// and sends the same four-field facts as for Claude Code. Negative cases: a failed skill call is no use, an unknown
// skill is not sent, no command text leaves the machine, the Claude Code harness does not read these files.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const SECRET = "SECRET-OPENCODE-do-not-upload";
let srv;
let base;
let work;
let root;
let alice;
let token;
const api = (method, path, body, who) => rawApi(base, method, path, body, who ? { cookie: who.cookie } : {});
const key = (sid) => createHash("sha256").update(sid).digest("hex").slice(0, 32);

// --- export generator -----------------------------------------------------
let n = 0;
const T0 = Date.parse("2026-11-14T09:00:00.000Z");
const part = (sid, tool, state) => ({ type: "tool", tool, callID: `call-${++n}`, state, id: `prt_${n}`, sessionID: sid, messageID: `msg_${n}` });
const skill = (sid, min, name, status = "completed") =>
  part(sid, "skill", { status, input: { name }, title: `Loaded skill: ${name}`, metadata: { name, dir: `C:\\Users\\dev\\${SECRET}\\.opencode\\skills\\${name}` }, output: `<skill_content name="${name}">${SECRET}`, time: { start: T0 + min * 60000, end: T0 + min * 60000 + 500 } });
const bash = (sid, min, command, exit) =>
  part(sid, "bash", { status: "completed", input: { command, workdir: `C:\\Users\\dev\\${SECRET}` }, metadata: { output: SECRET, exit, truncated: false }, output: `${SECRET}\n`, time: { start: T0 + min * 60000, end: T0 + min * 60000 + 200 } });
const text = (sid) => ({ type: "text", text: `please use ${SECRET}`, id: `prt_t${++n}`, sessionID: sid, messageID: `msg_t${n}` });
const exportOf = (sid, parts) => ({
  info: { id: sid, slug: "clever-otter", directory: `C:\\Users\\dev\\${SECRET}`, title: SECRET, version: "1.18.34", time: { created: T0, updated: T0 + 3600000 } },
  messages: [
    { info: { id: `msg_u_${sid}`, sessionID: sid, role: "user", time: { created: T0 } }, parts: [text(sid)] },
    { info: { id: `msg_a_${sid}`, sessionID: sid, role: "assistant", time: { created: T0 + 1000, completed: T0 + 5000 } }, parts },
  ],
});

const SESSIONS = {
  ses_pass0001: { verdict: "pass", parts: (s) => [skill(s, 1, "pdf-tools"), bash(s, 2, "npm test", 0)] },
  ses_fail0002: { verdict: "fail", parts: (s) => [skill(s, 3, "pdf-tools"), bash(s, 4, "node --test tests/x.test.mjs", 1)] },
  ses_none0003: { verdict: "none", parts: (s) => [skill(s, 5, "pdf-tools"), bash(s, 6, "ls -la", 0)] },
  ses_next0004: { verdict: "none", parts: (s) => [skill(s, 7, "pdf-tools"), skill(s, 8, "private-local"), bash(s, 9, "pytest -q", 0)] },
};
const UTF16 = "ses_utf16005";
const FAILED_CALL = "ses_error006";

function buildRoot() {
  root = join(work, "exports");
  mkdirSync(join(root, "calc"), { recursive: true });
  for (const [sid, v] of Object.entries(SESSIONS)) writeFileSync(join(root, "calc", `${sid}.json`), "\uFEFF" + JSON.stringify(exportOf(sid, v.parts(sid)), null, 2));
  const u16 = JSON.stringify(exportOf(UTF16, [skill(UTF16, 10, "pdf-tools"), bash(UTF16, 11, "npm run build", 1), bash(UTF16, 12, "npm run build", 0)]), null, 2);
  writeFileSync(join(root, "calc", `${UTF16}.json`), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(u16, "utf16le")]));
  writeFileSync(join(root, "calc", `${FAILED_CALL}.json`), JSON.stringify(exportOf(FAILED_CALL, [skill(FAILED_CALL, 13, "pdf-tools", "error")])));
  writeFileSync(join(root, "broken.json"), '{"info": {"id": "ses_broken"}, "messages": [');
  writeFileSync(join(root, "notes.txt"), JSON.stringify(exportOf("ses_txt", [skill("ses_txt", 1, "pdf-tools")])));
}

function cli(args, env = {}) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: base, SKILLFORGE_TOKEN: token, SKILLFORGE_SESSIONS_ROOT: undefined, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 90000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr });
    });
  });
}
const importArgs = (...extra) => ["sessions", "import", "--harness", "opencode", "--root", root, "--json", ...extra];

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI} — run npm run build`);
  srv = await startServer({}, { prefix: "skillforge-sessions-opencode-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  const admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-123", role: "contributor" });
  alice = await login(base, "alice", "alice-pw-123");
  token = (await api("POST", "/api/v1/me/tokens", { name: "cli" }, alice)).data.token;
  const r = await api("POST", "/api/v1/artifacts", { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, alice);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  work = mkdtempSync(join(tmpdir(), "skillforge-sessions-opencode-work-"));
  buildRoot();
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("--dry-run: facts of registry skills with verdicts, hashed session ids, no command text or secrets", async () => {
  const r = await cli(importArgs("--dry-run"));
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.ok(!(r.stdout + r.stderr).includes(SECRET), "a value from the session left the machine");
  assert.ok(!(r.stdout + r.stderr).includes("npm test"), "command text left the machine");
  const out = JSON.parse(r.stdout);
  const got = Object.fromEntries(out.facts.map((f) => [f.session_key, f.verification]));
  const want = { ...Object.fromEntries(Object.entries(SESSIONS).map(([s, v]) => [key(s), v.verdict])), [key(UTF16)]: "pass" };
  assert.deepEqual(got, want);
  for (const f of out.facts) {
    assert.deepEqual(Object.keys(f).sort(), ["session_key", "skill", "used_at", "verification"]);
    assert.equal(f.skill, "pdf-tools");
  }
  assert.ok(!Object.keys(got).includes(key(FAILED_CALL)), "a failed skill call counted as a use");
  assert.equal(out.skipped_lines, 1, "the broken export is skipped and counted");
  assert.ok(out.skipped_unknown >= 1, "private-local is not in the registry");
  assert.equal(out.facts.find((f) => f.session_key === key("ses_pass0001")).used_at, new Date(T0 + 60000).toISOString());
});

test("upload, then the same import again: duplicates only", async () => {
  const first = await cli(importArgs());
  assert.equal(first.code, 0, first.stderr + first.stdout);
  // all five accepted on the first upload also proves the dry run above sent nothing
  assert.equal(JSON.parse(first.stdout).uploaded.accepted, 5);
  const again = await cli(importArgs());
  assert.equal(again.code, 0, again.stderr + again.stdout);
  const up = JSON.parse(again.stdout).uploaded;
  assert.equal(up.accepted, 0);
  assert.equal(up.duplicates, 5);
});

test("no root for OpenCode: exit 2 with the way to get one; Claude Code does not read the exports", async () => {
  const r = await cli(["sessions", "import", "--harness", "opencode", "--dry-run", "--json"]);
  assert.equal(r.code, 2, r.stderr + r.stdout);
  assert.match(r.stderr + r.stdout, /opencode export/);
  assert.match(r.stderr + r.stdout, /--root/);
  const cc = await cli(["sessions", "import", "--harness", "claude-code", "--root", root, "--dry-run", "--json"]);
  assert.equal(cc.code, 0, cc.stderr + cc.stdout);
  assert.equal(JSON.parse(cc.stdout).facts.length, 0);
});
