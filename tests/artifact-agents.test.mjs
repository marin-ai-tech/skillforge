// Acceptance tests for which agents and versions an artifact is intended for. The oracle is the artifact-api and cli specs and the
// core runtime table (RUNTIMES): computation by type (`agents.supported`) and the author's declaration (`agents.declared`: agent + minimum
// version), the catalog `agent` filter, editing the declaration in metadata, the CLI flag `publish --agents` and the `install` warning.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIMES } from "../packages/core/dist/index.js";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const ALL = RUNTIMES.map((r) => r.id);
let srv;
let base;
let admin;
let alice;
let bob;
let aliceToken;
let work;

const skillFiles = (name, description) => [
  {
    path: `${name}/SKILL.md`,
    content_base64: Buffer.from(`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nSteps for the task.\n`).toString("base64"),
  },
];

function cli(args) {
  return new Promise((resolve) => {
    const h = join(work, "home");
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), SKILLFORGE_URL: base, SKILLFORGE_TOKEN: aliceToken, NO_COLOR: "1", HOME: h, USERPROFILE: h },
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

const card = async (type, name, who = admin) => (await api(base, "GET", `/api/v1/artifacts/${type}/${name}`, undefined, { cookie: who.cookie })).data;
const names = async (query) => {
  const r = await api(base, "GET", `/api/v1/artifacts?${query}&limit=100`, undefined, { cookie: admin.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.items.map((a) => `${a.type}/${a.name}`);
};

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-agents-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-123", role: "contributor" });
  await createUser(base, admin.cookie, { username: "bob", password: "bob-pw-12345", role: "contributor" });
  alice = await login(base, "alice", "alice-pw-123");
  bob = await login(base, "bob", "bob-pw-12345");
  aliceToken = (await api(base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: alice.cookie })).data.token;
  work = mkdtempSync(join(tmpdir(), "skillforge-agents-work-"));
  mkdirSync(join(work, "home"), { recursive: true });
  const plain = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, { cookie: alice.cookie });
  assert.equal(plain.status, 201, JSON.stringify(plain.data));
  const hook = await api(base, "POST", "/api/v1/artifacts", { type: "hook", name: "destructive-guard", files: toB64(loadDir(join(FIXTURES, "hook-guard"))) }, { cookie: admin.cookie });
  assert.equal(hook.status, 201, JSON.stringify(hook.data));
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("no declaration: supported is every agent the type installs into; declared is empty", async () => {
  const skill = await card("skill", "pdf-tools");
  assert.deepEqual([...skill.artifact.agents.supported].sort(), [...ALL].sort());
  assert.deepEqual(skill.artifact.agents.declared, []);
  const hook = await card("hook", "destructive-guard");
  assert.deepEqual(hook.artifact.agents.supported, ["claude-code"], "hooks install only into Claude Code");
  const list = await api(base, "GET", "/api/v1/artifacts?type=skill", undefined, { cookie: admin.cookie });
  assert.ok(list.data.items.every((a) => a.agents && Array.isArray(a.agents.supported)), "the agents field is in the list too");
});

test("declaration at publish: agent and minimum version; array and string", async () => {
  const r = await api(
    base,
    "POST",
    "/api/v1/artifacts",
    { type: "skill", files: skillFiles("cc-codex-skill", "Skill declared for Claude Code and Codex. Use for agent tests."), agents: [{ runtime: "claude-code", min_version: "2.1" }, { runtime: "codex" }] },
    { cookie: alice.cookie },
  );
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const c = await card("skill", "cc-codex-skill");
  assert.deepEqual(c.artifact.agents.declared, [
    { runtime: "claude-code", min_version: "2.1" },
    { runtime: "codex", min_version: null },
  ]);
  const s = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: skillFiles("gemini-skill", "Skill declared for Gemini CLI only. Use for agent tests."), agents: "gemini>=0.12" }, { cookie: alice.cookie });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.deepEqual((await card("skill", "gemini-skill")).artifact.agents.declared, [{ runtime: "gemini", min_version: "0.12" }]);
});

test("a new version without the agents field inherits the previous version's declaration; an empty list clears it", async () => {
  const files = (body) => [{ path: "cc-codex-skill/SKILL.md", content_base64: Buffer.from(`---
name: cc-codex-skill
description: Skill declared for Claude Code and Codex. Use for agent tests.
---

# cc-codex-skill

${body}
`).toString("base64") }];
  const v2 = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: files("Second version.") }, { cookie: alice.cookie });
  assert.equal(v2.status, 201, JSON.stringify(v2.data));
  assert.deepEqual((await card("skill", "cc-codex-skill")).artifact.agents.declared, [
    { runtime: "claude-code", min_version: "2.1" },
    { runtime: "codex", min_version: null },
  ]);
  const v3 = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: files("Third version."), agents: [] }, { cookie: alice.cookie });
  assert.equal(v3.status, 201, JSON.stringify(v3.data));
  assert.deepEqual((await card("skill", "cc-codex-skill")).artifact.agents.declared, []);
  const v4 = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: files("Fourth version."), agents: "claude-code>=2.1,codex" }, { cookie: alice.cookie });
  assert.equal(v4.status, 201, JSON.stringify(v4.data));
});

test("an invalid declaration is rejected with 400 agents_invalid, no version is created", async () => {
  const cases = [
    { type: "hook", name: "hook-for-codex", files: toB64(loadDir(join(FIXTURES, "hook-guard"))), agents: [{ runtime: "codex" }] },
    { type: "skill", files: skillFiles("bad-runtime", "Bad runtime declaration for the test."), agents: [{ runtime: "unknown-agent" }] },
    { type: "skill", files: skillFiles("bad-version", "Bad version declaration for the test."), agents: [{ runtime: "codex", min_version: "2.x" }] },
    { type: "skill", files: skillFiles("dup-runtime", "Duplicate runtime declaration for the test."), agents: [{ runtime: "codex" }, { runtime: "codex" }] },
    { type: "command", files: [{ path: "cmd-codex.md", content_base64: Buffer.from("---\ndescription: Command for codex.\n---\n\nDo it.\n").toString("base64") }], agents: "codex" },
  ];
  for (const body of cases) {
    const r = await api(base, "POST", "/api/v1/artifacts", body, { cookie: alice.cookie });
    assert.equal(r.status, 400, `${JSON.stringify(body.agents)} → ${r.status} ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, "agents_invalid");
    assert.ok(r.data.detail, "the reason for the refusal is named");
  }
  for (const name of ["hook/hook-for-codex", "skill/bad-runtime", "skill/bad-version", "skill/dup-runtime", "command/cmd-codex"]) {
    const g = await api(base, "GET", `/api/v1/artifacts/${name}`, undefined, { cookie: admin.cookie });
    assert.equal(g.status, 404, `${name} was not created`);
  }
});

test("agent filter: the type installs into the agent and the agent is in the declaration, if there is one", async () => {
  const cursor = await names("agent=cursor");
  assert.ok(cursor.includes("skill/pdf-tools"), "no declaration: fits every agent that installs the type");
  assert.ok(!cursor.includes("skill/cc-codex-skill"), "declaration without cursor: does not fit");
  assert.ok(!cursor.includes("hook/destructive-guard"), "a hook is not installed into cursor");
  const codex = await names("agent=codex");
  assert.ok(codex.includes("skill/cc-codex-skill"));
  assert.ok(!codex.includes("skill/gemini-skill"));
  const claude = await names("agent=claude-code");
  assert.ok(claude.includes("hook/destructive-guard"));
  const bad = await api(base, "GET", "/api/v1/artifacts?agent=x%27%20OR%201%3D1--", undefined, { cookie: admin.cookie });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, "agent_invalid");
});

test("editing the declaration in metadata: the owner changes it without a new version, with audit; a non-owner gets 403", async () => {
  const before = await card("skill", "pdf-tools");
  const r = await api(base, "PATCH", "/api/v1/artifacts/skill/pdf-tools/metadata", { agents: [{ runtime: "opencode", min_version: "1.0" }] }, { cookie: alice.cookie });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const after = await card("skill", "pdf-tools");
  assert.deepEqual(after.artifact.agents.declared, [{ runtime: "opencode", min_version: "1.0" }]);
  assert.equal(after.artifact.versions_count, before.artifact.versions_count, "no new version was created");
  const audit = await api(base, "GET", "/api/v1/artifacts/skill/pdf-tools/audit", undefined, { cookie: admin.cookie });
  const items = audit.data.items ?? audit.data;
  assert.ok(JSON.stringify(items).includes("opencode"), "the declaration change is in the audit");
  const foreign = await api(base, "PATCH", "/api/v1/artifacts/skill/pdf-tools/metadata", { agents: [{ runtime: "codex" }] }, { cookie: bob.cookie });
  assert.equal(foreign.status, 403);
  const invalid = await api(base, "PATCH", "/api/v1/artifacts/skill/pdf-tools/metadata", { agents: [{ runtime: "codex", min_version: "latest" }] }, { cookie: alice.cookie });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.error, "agents_invalid");
  const reset = await api(base, "PATCH", "/api/v1/artifacts/skill/pdf-tools/metadata", { agents: null }, { cookie: alice.cookie });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  assert.deepEqual((await card("skill", "pdf-tools")).artifact.agents.declared, [], "null clears the edit: the version's declaration applies again");
});

test("CLI: publish --agents, flag validated before the server, install warning", async () => {
  const dir = join(work, "cli-skill");
  mkdirSync(join(dir, "cli-agents-skill"), { recursive: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(dir, "cli-agents-skill", "SKILL.md"), "---\nname: cli-agents-skill\ndescription: Skill published from the CLI with an agents declaration.\n---\n\n# Skill\n\nDo the task.\n");
  const bad = await cli(["publish", join(dir, "cli-agents-skill"), "--type", "skill", "--agents", "unknown-agent"]);
  assert.equal(bad.code, 1, bad.err);
  assert.match(bad.err + bad.out, /unknown-agent/);
  assert.equal((await api(base, "GET", "/api/v1/artifacts/skill/cli-agents-skill", undefined, { cookie: admin.cookie })).status, 404, "it never reached the server");
  const ok = await cli(["publish", join(dir, "cli-agents-skill"), "--type", "skill", "--agents", "claude-code>=2.1,codex"]);
  assert.equal(ok.code, 0, ok.err + ok.out);
  assert.deepEqual((await card("skill", "cli-agents-skill")).artifact.agents.declared, [
    { runtime: "claude-code", min_version: "2.1" },
    { runtime: "codex", min_version: null },
  ]);
  const t = await api(base, "POST", "/api/v1/artifacts/skill/cli-agents-skill/transitions", { to: "active", reason: "agents test" }, { cookie: admin.cookie });
  assert.equal(t.status, 200);
  const foreign = await cli(["install", "skill/cli-agents-skill", "--runtime", "cursor"]);
  assert.equal(foreign.code, 0, foreign.err + foreign.out);
  assert.match(foreign.err, /warning: .*cli-agents-skill.*declared for .*claude-code.*cursor is not in the list/i);
  const declared = await cli(["install", "skill/cli-agents-skill", "--runtime", "claude-code"]);
  assert.equal(declared.code, 0, declared.err + declared.out);
  assert.match(declared.err, /note: declared for claude-code >= 2\.1/);
  assert.doesNotMatch(declared.err, /warning/);
});
