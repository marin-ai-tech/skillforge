// Acceptance tests: session import sees skills preloaded for a subagent via the `skills:` field.
// The line shapes come from a real stand log; the fixture has no message content.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let base;
let admin;
let alice;
let token;
let work;
const api = (method, path, body, who) => rawApi(base, method, path, body, who ? { cookie: who.cookie } : {});
const metrics = async (name) => (await api("GET", `/api/v1/artifacts/skill/${name}/metrics`)).data;
const key = (sid) => createHash("sha256").update(sid).digest("hex").slice(0, 32);
const T = "2026-10-20T10:00:00.000Z";

const skillMd = (name) => `---\nname: ${name}\ndescription: Skill ${name} for preloaded session facts. Use when the user asks for ${name}.\n---\n\n# ${name}\n\nBody.\n`;

const preload = (sid, agentId, name, over = {}) =>
  JSON.stringify({
    parentUuid: null,
    isSidechain: true,
    agentId,
    type: "user",
    isMeta: true,
    timestamp: T,
    sessionId: sid,
    message: { role: "user", content: [{ type: "text", text: `<command-message>${name}</command-message>\n<command-name>${name}</command-name>` }] },
    ...over,
  }) + "\n";
const skillCall = (sid, agentId, name, t = "2026-10-20T10:01:00.000Z") =>
  JSON.stringify({ isSidechain: true, agentId, type: "assistant", timestamp: t, sessionId: sid, message: { role: "assistant", content: [{ type: "tool_use", id: "s1", name: "Skill", input: { skill: name } }] } }) + "\n";
const bash = (sid, agentId, cmd) =>
  JSON.stringify({ isSidechain: true, agentId, type: "assistant", timestamp: "2026-10-20T10:02:00.000Z", sessionId: sid, message: { role: "assistant", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: cmd } }] } }) + "\n";
const bashOk = (sid, agentId) =>
  JSON.stringify({ isSidechain: true, agentId, type: "user", timestamp: "2026-10-20T10:03:00.000Z", sessionId: sid, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "b1", content: "ok" }] } }) + "\n";

/** One subagent run: `<root>/<project>/<session>/subagents/agent-<id>.jsonl`. */
function subagent(root, sid, agentId, body) {
  const dir = join(root, "-proj", sid, "subagents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `agent-${agentId}.jsonl`), body);
}

function importFrom(root, ...extra) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, "sessions", "import", "--root", root, "--json", ...extra], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: base, SKILLFORGE_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 60000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      res({ code, json: stdout ? JSON.parse(stdout) : null, stderr });
    });
  });
}
const newRoot = (name) => {
  const root = join(work, name);
  mkdirSync(root, { recursive: true });
  return root;
};

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-preloaded-" });
  assert.ok(srv.up, srv.stderr);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-123", role: "contributor" });
  alice = await login(base, "alice", "alice-pw-123");
  token = (await api("POST", "/api/v1/me/tokens", { name: "cli" }, alice)).data.token;
  for (const name of ["loaded-one", "loaded-two", "both-ways", "api-facts"]) {
    const r = await api("POST", "/api/v1/artifacts", { type: "skill", files: [{ path: `${name}/SKILL.md`, content_base64: Buffer.from(skillMd(name)).toString("base64") }] }, alice);
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  work = mkdtempSync(join(tmpdir(), "skillforge-preloaded-work-"));
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("preloading yields a preloaded fact with a launch check; re-importing does not double it", async () => {
  const root = newRoot("a");
  subagent(root, "sess-one", "a1", preload("sess-one", "a1", "loaded-one") + preload("sess-one", "a1", "loaded-two") + bash("sess-one", "a1", "npm test") + bashOk("sess-one", "a1"));
  const dry = await importFrom(root, "--dry-run");
  assert.equal(dry.code, 0, dry.stderr);
  const facts = Object.fromEntries(dry.json.facts.map((f) => [f.skill, f]));
  assert.deepEqual(Object.keys(facts).sort(), ["loaded-one", "loaded-two"]);
  assert.equal(facts["loaded-one"].basis, "preloaded");
  assert.equal(facts["loaded-one"].verification, "pass");
  assert.equal(facts["loaded-one"].session_key, key("sess-one"));
  assert.equal(facts["loaded-one"].used_at, T);

  const first = await importFrom(root);
  assert.equal(first.json.uploaded.accepted, 2, JSON.stringify(first.json));
  const second = await importFrom(root);
  assert.equal(second.json.uploaded.accepted, 0);
  assert.equal(second.json.uploaded.duplicates, 2);
  const m = await metrics("loaded-one");
  assert.equal(m.sessions_count, 1);
  assert.equal(m.preloaded_sessions_count, 1);
});

test("a Skill call and preloading in one run give a single invoked fact", async () => {
  const root = newRoot("b");
  subagent(root, "sess-two", "b1", preload("sess-two", "b1", "both-ways") + skillCall("sess-two", "b1", "both-ways"));
  const dry = await importFrom(root, "--dry-run");
  const mine = dry.json.facts.filter((f) => f.skill === "both-ways");
  assert.equal(mine.length, 1, JSON.stringify(mine));
  assert.notEqual(mine[0].basis, "preloaded");
  await importFrom(root);
  const m = await metrics("both-ways");
  assert.equal(m.sessions_count, 1);
  assert.equal(m.preloaded_sessions_count, 0);
});

test("negative cases: names outside the registry are skipped_unknown; without skills and without markers there are no facts", async () => {
  const root = newRoot("c");
  subagent(root, "sess-three", "c1", preload("sess-three", "c1", "sdlc:plan") + preload("sess-three", "c1", "not-in-registry"));
  subagent(root, "sess-four", "c2", bash("sess-four", "c2", "ls"));
  // The tag inside an ordinary message or quoted text is not a load.
  subagent(
    root,
    "sess-five",
    "c3",
    preload("sess-five", "c3", "loaded-one", { isMeta: undefined }) +
      preload("sess-five", "c3", "loaded-one", { isSidechain: false }) +
      JSON.stringify({ isSidechain: true, isMeta: true, agentId: "c3", type: "user", timestamp: T, sessionId: "sess-five", message: { role: "user", content: [{ type: "text", text: "the log said <command-name>loaded-one</command-name> earlier" }] } }) +
      "\n",
  );
  const dry = await importFrom(root, "--dry-run");
  assert.equal(dry.code, 0, dry.stderr);
  assert.deepEqual(dry.json.facts, []);
  assert.equal(dry.json.skipped_unknown, 2);
});

test("intake: basis defaults to invoked, preloaded is stored, an invalid value is rejected, nothing extra is in the database", async () => {
  const fact = (i, over = {}) => ({ skill: "api-facts", session_key: i.toString(16).padStart(32, "0"), used_at: T, verification: "none", ...over });
  const r = await api("POST", "/api/v1/me/session-facts", { source: "t", facts: [fact(1), fact(2, { basis: "preloaded" }), fact(3, { basis: "maybe" }), fact(4, { basis: 7 })] }, alice);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.accepted, 2);
  assert.equal(r.data.rejected, 2);
  const m = await metrics("api-facts");
  assert.equal(m.sessions_count, 2);
  assert.equal(m.preloaded_sessions_count, 1);
});
