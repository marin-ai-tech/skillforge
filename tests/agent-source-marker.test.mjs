// agent-source-marker (X1 of the OpenCode field test): a file built from a registry artifact carries
// `skillforge-source: <type>/<name>@<version>` in its front matter, and the agent snapshot links it to that artifact
// instead of showing one local_only and one registry_only row. Negative cases: no marker, a marker on an invisible
// team artifact, on a missing artifact, and an unparsable marker all behave as before and reveal nothing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let base;
let work;
let admin;
let alice;
let bob;
let aliceToken;

const agentMd = (name, version) => `---\nname: ${name}\ndescription: Designs the solution and records decisions. Version ${version}.\n---\n\nYou are the ${name}. Write the design before the code.\n`;
const built = (marker, role) => `---\ndescription: The ${role} role of this project.\nmode: subagent\n${marker === null ? "" : `skillforge-source: ${marker}\n`}---\n\nYou are the ${role} of this project. Project paths: src/.\n`;

function cli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: base, SKILLFORGE_TOKEN: aliceToken },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 60000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function publishAgent(who, name, version, extra = {}) {
  const files = [{ path: `agents/${name}.md`, content_base64: Buffer.from(agentMd(name, version)).toString("base64") }];
  const r = await api(base, "POST", "/api/v1/artifacts", { type: "agent", version, files, ...extra }, { cookie: who.cookie });
  assert.equal(r.status, 201, JSON.stringify(r.data));
}

async function activate(name) {
  const t = await api(base, "POST", `/api/v1/artifacts/agent/${name}/transitions`, { to: "active", reason: "fixture" }, { cookie: admin.cookie });
  assert.equal(t.status, 200, JSON.stringify(t.data));
}

function project(files) {
  const dir = mkdtempSync(join(work, "proj-"));
  mkdirSync(join(dir, ".opencode", "agents"), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, ".opencode", "agents", `${name}.md`), text);
  return join(dir, ".opencode");
}

async function scan(dir, name) {
  const r = await cli(["agent", "scan", dir, "--name", name, "--runtime", "opencode", "--json"]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const data = JSON.parse(r.stdout);
  const items = data.items ?? data.compared?.items;
  const registryOnly = data.registry_only ?? data.compared?.registry_only ?? [];
  return { items: Object.fromEntries(items.map((i) => [i.key, i])), registryOnly: registryOnly.map((x) => `${x.type}/${x.name}`), raw: r.stdout };
}

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI}`);
  srv = await startServer({}, { prefix: "skillforge-agent-source-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "bob"]) await createUser(base, admin.cookie, { username: u, password: `${u}-pw-123`, role: "contributor" });
  alice = await login(base, "alice", "alice-pw-123");
  bob = await login(base, "bob", "bob-pw-123");
  aliceToken = (await api(base, "POST", "/api/v1/me/tokens", { name: "cli" }, { cookie: alice.cookie })).data.token;
  assert.equal((await api(base, "POST", "/api/v1/teams", { name: "beta", lead: "bob" }, { cookie: admin.cookie })).status, 201);
  await publishAgent(alice, "architect", "1.0.0");
  await activate("architect");
  await publishAgent(bob, "beta-secret", "1.0.0", { visibility: "team", owner_team: "beta" });
  await activate("beta-secret");
  work = mkdtempSync(join(tmpdir(), "skillforge-agent-source-work-"));
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("a built role agent with a marker is linked to its source; without a marker it stays local_only", async () => {
  const dir = project({ "sdlc-architect": built("agent/architect@1.0.0", "architect"), "sdlc-plain": built(null, "plain") });
  const s = await scan(dir, "oc");
  const a = s.items["agent/sdlc-architect"];
  assert.ok(a, s.raw);
  assert.equal(a.status, "in_sync", s.raw);
  assert.deepEqual(a.source, { type: "agent", name: "architect", version: "1.0.0" });
  assert.equal(a.registry.latest_version, "1.0.0");
  assert.ok(!s.registryOnly.includes("agent/architect"), "the source is listed as registry_only");
  assert.equal(s.items["agent/sdlc-plain"].status, "local_only");
  assert.equal(s.items["agent/sdlc-plain"].source, undefined);

  const table = await cli(["agent", "scan", dir, "--name", "oc", "--runtime", "opencode"]);
  assert.equal(table.code, 0, table.stderr);
  assert.match(table.stdout, /sdlc-architect[^\n]*agent\/architect@1\.0\.0/, table.stdout);
});

test("a new source version makes the built copy outdated", async () => {
  await publishAgent(alice, "architect", "1.1.0");
  const dir = project({ "sdlc-architect": built("agent/architect@1.0.0", "architect") });
  const s = await scan(dir, "oc2");
  assert.equal(s.items["agent/sdlc-architect"].status, "outdated", s.raw);
  assert.equal(s.items["agent/sdlc-architect"].registry.latest_version, "1.1.0");
});

test("a marker on an invisible, missing or unparsable source behaves as no marker and reveals nothing", async () => {
  const dir = project({
    "sdlc-hidden": built("agent/beta-secret@1.0.0", "hidden"),
    "sdlc-ghost": built("agent/ghost-role@1.0.0", "ghost"),
    "sdlc-bad": built("architect", "bad"),
  });
  const s = await scan(dir, "oc3");
  for (const key of ["agent/sdlc-hidden", "agent/sdlc-ghost", "agent/sdlc-bad"]) {
    assert.equal(s.items[key].status, "local_only", `${key}: ${s.raw}`);
    assert.equal(s.items[key].source, undefined, key);
  }
  assert.ok(!s.raw.includes("beta-secret"), "the invisible team artifact is named in the answer");
});

test("the organisation inventory counts the built copy at its source", async () => {
  const inv = await api(base, "GET", "/api/v1/admin/inventory", undefined, { cookie: admin.cookie });
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  const names = inv.data.artifacts.map((a) => `${a.type}/${a.name}`);
  assert.ok(names.includes("agent/architect"), names.join(", "));
  assert.ok(!names.includes("agent/sdlc-architect"), names.join(", "));
  const arch = inv.data.artifacts.find((a) => a.name === "architect");
  assert.equal(arch.origin, "own");
  assert.ok(arch.copies >= 2, JSON.stringify(arch));
});
