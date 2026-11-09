// Acceptance tests for agent inventory: snapshots, comparison with the registry, publishing from a snapshot, server agents. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD, freePort } from "./lib/client.mjs";

const SERVER = join(ROOT, "packages", "server", "dist", "index.js");
const LOCAL_NOTES = "---\nname: local-notes\ndescription: Keeps short project notes and reminders. Use when the user asks to remember or recall a note.\n---\n\n# Local notes\n\nStore notes in `notes.md`; recall them on request.\n";

let work;
let roots;
let srv;
let base;
let admin;
let alice;
let bob;
let rita;
let aliceToken;

function runNode(args, env, cwd = ROOT) {
  return new Promise((res) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 15000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr: code === null ? `${stderr}\n(process did not exit within 15s — killed)` : stderr });
    });
  });
}

async function until(fn, { timeout = 5000, step = 100 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}

/** Files in the directory of agent alice: pdf-tools as in the registry, local-notes is new, propose is modified, README is extra. */
function laptopFiles({ pdfToolsDir = "skill-standard", proposeSuffix = "\n\nLocal tweak.\n" } = {}) {
  const pdf = loadDir(join(FIXTURES, pdfToolsDir)).map((f) => ({ path: `skills/${f.path}`, content: f.content }));
  const propose = loadDir(join(FIXTURES, "command-propose"))[0];
  return toB64([
    ...pdf,
    { path: "skills/local-notes/SKILL.md", content: Buffer.from(LOCAL_NOTES) },
    { path: "commands/propose.md", content: Buffer.concat([propose.content, Buffer.from(proposeSuffix)]) },
    { path: "README.md", content: Buffer.from("# my agent\n") },
  ]);
}

const LOCK = { registry: "http://example", artifacts: { "skill/pdf-tools": { version: "0.1.0", digest: "", files: {}, installed_at: "2026-09-19T00:00:00.000Z" } } };

const item = (res, key) => res.data.items.find((i) => i.key === key);

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-agents-work-"));
  roots = join(work, "roots");
  mkdirSync(roots, { recursive: true });
  const pluginsDir = join(work, "plugins");
  cpSync(join(ROOT, "tests", "fixtures", "plugins", "agent-watch"), join(pluginsDir, "agent-watch"), { recursive: true });
  srv = await startServer({ SKILLFORGE_AGENT_ROOTS: roots, SKILLFORGE_PLUGINS_DIR: pluginsDir }, { prefix: "skillforge-agents-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  await createUser(base, admin.cookie, { username: "bob", password: "bob-pw-123", role: "viewer" });
  await createUser(base, admin.cookie, { username: "rita", password: "rita-pw-123", role: "reviewer" });
  alice = await login(base, "alice", "alice-pw-1");
  bob = await login(base, "bob", "bob-pw-123");
  rita = await login(base, "rita", "rita-pw-123");
  aliceToken = (await api(base, "POST", "/api/v1/me/tokens", { name: "t" }, { cookie: alice.cookie })).data.token;
  for (const [type, dir, extra] of [
    ["skill", "skill-standard", {}],
    ["skill", "skill-e2e", { version: "1.0.0" }],
    ["command", "command-propose", {}],
    ["agent", "agent-executor", {}],
  ]) {
    const r = await api(base, "POST", "/api/v1/artifacts", { type, ...extra, files: toB64(loadDir(join(FIXTURES, dir))) }, { token: aliceToken });
    assert.equal(r.status, 201, `${type}/${dir}: ${r.status} ${JSON.stringify(r.data)}`);
  }
  const promote = await api(base, "POST", "/api/v1/artifacts/skill/pdf-tools-e2e/transitions", { to: "active" }, { cookie: rita.cookie });
  assert.equal(promote.status, 200);
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("snapshot: statuses local_only / in_sync / modified, skipped, registry_only, agent list, validation", async () => {
  const anon = await api(base, "PUT", "/api/v1/me/agents/laptop", { files: laptopFiles() });
  assert.equal(anon.status, 401);
  const put = await api(base, "PUT", "/api/v1/me/agents/laptop", { runtime: "claude-code", files: laptopFiles(), lock: LOCK }, { cookie: alice.cookie });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal(put.data.agent.name, "laptop");
  assert.equal(put.data.agent.kind, "upload");
  assert.equal(put.data.agent.runtime, "claude-code");
  assert.ok(typeof put.data.agent.scanned_at === "string");
  assert.deepEqual(put.data.items.map((i) => i.key).sort(), ["command/propose", "skill/local-notes", "skill/pdf-tools"]);
  const pdf = item(put, "skill/pdf-tools");
  assert.equal(pdf.status, "in_sync");
  assert.equal(pdf.local.version, "0.1.0");
  assert.match(pdf.local.digest, /^[0-9a-f]{64}$/);
  assert.equal(pdf.local.files, 2);
  assert.equal(pdf.registry.latest_version, "0.1.0");
  assert.equal(pdf.registry.matched_version, "0.1.0");
  assert.equal(pdf.registry.status, "candidate");
  const notes = item(put, "skill/local-notes");
  assert.equal(notes.status, "local_only");
  assert.equal(notes.registry, null);
  assert.equal(notes.local.version, null);
  const propose = item(put, "command/propose");
  assert.equal(propose.status, "modified");
  assert.equal(propose.registry.matched_version, null);
  assert.deepEqual(propose.changed_files, ["commands/propose.md"]);
  assert.deepEqual(put.data.skipped.map((s) => s.path), ["README.md"]);
  assert.deepEqual(put.data.invalid, []);
  assert.deepEqual(put.data.summary, { local_only: 1, in_sync: 1, outdated: 0, modified: 1, registry_only: 1 });
  assert.deepEqual(put.data.registry_only.map((r) => `${r.type}/${r.name}`), ["skill/pdf-tools-e2e"]);
  assert.equal(put.data.registry_only[0].status, "active");
  assert.equal(put.data.registry_only[0].latest_version, "1.0.0");

  const all = await api(base, "GET", "/api/v1/me/agents/laptop?registry_status=all", undefined, { cookie: alice.cookie });
  assert.equal(all.status, 200);
  assert.deepEqual(all.data.registry_only.map((r) => `${r.type}/${r.name}`).sort(), ["agent/handoff-executor", "skill/pdf-tools-e2e"]);
  assert.equal(all.data.summary.registry_only, 2);

  const list = await api(base, "GET", "/api/v1/me/agents", undefined, { cookie: alice.cookie });
  assert.equal(list.status, 200);
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].name, "laptop");
  assert.equal(list.data.items[0].item_count, 3);
  assert.equal(list.data.items[0].summary.local_only, 1);

  const badName = await api(base, "PUT", "/api/v1/me/agents/Bad%20Name", { files: laptopFiles() }, { cookie: alice.cookie });
  assert.equal(badName.status, 400);
  const noFiles = await api(base, "PUT", "/api/v1/me/agents/laptop2", {}, { cookie: alice.cookie });
  assert.equal(noFiles.status, 400);
  const badSkill = await api(base, "PUT", "/api/v1/me/agents/laptop2", { files: toB64([{ path: "skills/bad/SKILL.md", content: Buffer.from("---\nname: Bad Name\ndescription: x\n---\n\nBody.\n") }]) }, { cookie: alice.cookie });
  assert.equal(badSkill.status, 200, JSON.stringify(badSkill.data));
  assert.deepEqual(badSkill.data.items, []);
  assert.equal(badSkill.data.invalid.length, 1);
  assert.equal(badSkill.data.invalid[0].root, "skills/bad");
  assert.ok(badSkill.data.invalid[0].errors.some((e) => e.code === "E_NAME_INVALID"), JSON.stringify(badSkill.data.invalid));
  const del2 = await api(base, "DELETE", "/api/v1/me/agents/laptop2", undefined, { cookie: alice.cookie });
  assert.equal(del2.status, 204);
});

test("owner isolation and admin overview", async () => {
  const other = await api(base, "GET", "/api/v1/me/agents/laptop", undefined, { cookie: bob.cookie });
  assert.equal(other.status, 404);
  const bobOwn = await api(base, "PUT", "/api/v1/me/agents/laptop", { files: toB64([{ path: "skills/local-notes/SKILL.md", content: Buffer.from(LOCAL_NOTES) }]) }, { cookie: bob.cookie });
  assert.equal(bobOwn.status, 200, "agent names are unique within an owner");
  assert.equal(bobOwn.data.items.length, 1);
  const aliceStill = await api(base, "GET", "/api/v1/me/agents/laptop", undefined, { cookie: alice.cookie });
  assert.equal(aliceStill.data.items.length, 3);
  const adminList = await api(base, "GET", "/api/v1/admin/agents", undefined, { cookie: admin.cookie });
  assert.equal(adminList.status, 200);
  const owners = adminList.data.items.filter((a) => a.name === "laptop").map((a) => a.owner.username).sort();
  assert.deepEqual(owners, ["alice", "bob"]);
  const notAdmin = await api(base, "GET", "/api/v1/admin/agents", undefined, { cookie: alice.cookie });
  assert.equal(notAdmin.status, 403);
  const bobDel = await api(base, "DELETE", "/api/v1/me/agents/laptop", undefined, { cookie: bob.cookie });
  assert.equal(bobDel.status, 204);
});

test("live comparison: after publishing 0.2.0 the item becomes outdated, a new snapshot is in_sync", async () => {
  const v2 = loadDir(join(FIXTURES, "skill-standard")).map((f) => (f.path.endsWith("SKILL.md") ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + "\nv2\n") } : f));
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "skill", version: "0.2.0", files: toB64(v2) }, { token: aliceToken });
  assert.equal(pub.status, 201);
  const after = await api(base, "GET", "/api/v1/me/agents/laptop", undefined, { cookie: alice.cookie });
  const pdf = item(after, "skill/pdf-tools");
  assert.equal(pdf.status, "outdated");
  assert.equal(pdf.registry.matched_version, "0.1.0");
  assert.equal(pdf.registry.latest_version, "0.2.0");
  assert.equal(after.data.summary.outdated, 1);
  assert.equal(after.data.summary.in_sync, 0);

  const files = toB64([
    ...v2.map((f) => ({ path: `skills/${f.path}`, content: f.content })),
    { path: "skills/local-notes/SKILL.md", content: Buffer.from(LOCAL_NOTES) },
    { path: "commands/propose.md", content: Buffer.concat([loadDir(join(FIXTURES, "command-propose"))[0].content, Buffer.from("\n\nLocal tweak.\n")]) },
  ]);
  const re = await api(base, "PUT", "/api/v1/me/agents/laptop", { files, lock: { registry: base, artifacts: { "skill/pdf-tools": { version: "0.2.0", digest: pub.data.version.digest, files: {}, installed_at: "2026-09-19T00:00:00.000Z" } } } }, { cookie: alice.cookie });
  assert.equal(re.status, 200);
  assert.equal(item(re, "skill/pdf-tools").status, "in_sync");
  assert.equal(item(re, "skill/pdf-tools").local.version, "0.2.0");
  assert.equal(re.data.summary.in_sync, 1);
});

test("publish from a snapshot: local_only → candidate with provenance agent, repeat → 409, roles, modified → new version", async () => {
  const viewer = await api(base, "POST", "/api/v1/me/agents/laptop/items/skill/local-notes/publish", {}, { cookie: bob.cookie });
  assert.equal(viewer.status, 404, "bob has no laptop agent after deletion");
  const pub = await api(base, "POST", "/api/v1/me/agents/laptop/items/skill/local-notes/publish", {}, { cookie: alice.cookie });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  assert.equal(pub.data.artifact.type, "skill");
  assert.equal(pub.data.artifact.name, "local-notes");
  assert.equal(pub.data.artifact.status, "candidate");
  assert.equal(pub.data.version.version, "0.1.0");
  assert.deepEqual(pub.data.version.provenance, { source: "agent", ref: "laptop" });
  assert.equal(pub.data.version.published_by, "alice");
  const card = await api(base, "GET", "/api/v1/artifacts/skill/local-notes", undefined, { cookie: alice.cookie });
  assert.equal(card.status, 200);
  assert.equal(card.data.latest.provenance.source, "agent");
  const status = await api(base, "GET", "/api/v1/me/agents/laptop", undefined, { cookie: alice.cookie });
  assert.equal(item(status, "skill/local-notes").status, "in_sync");
  assert.equal(status.data.summary.local_only, 0);
  const again = await api(base, "POST", "/api/v1/me/agents/laptop/items/skill/local-notes/publish", {}, { cookie: alice.cookie });
  assert.equal(again.status, 409);
  assert.equal(again.data.error, "digest_exists");
  const missing = await api(base, "POST", "/api/v1/me/agents/laptop/items/skill/nope/publish", {}, { cookie: alice.cookie });
  assert.equal(missing.status, 404);

  const modified = await api(base, "POST", "/api/v1/me/agents/laptop/items/command/propose/publish", { changelog: "Local tweak" }, { cookie: alice.cookie });
  assert.equal(modified.status, 201, JSON.stringify(modified.data));
  assert.equal(modified.data.version.version, "0.1.1", "auto version is a patch bump from latest");
  assert.equal(modified.data.version.changelog, "Local tweak");
  const after = await api(base, "GET", "/api/v1/me/agents/laptop", undefined, { cookie: alice.cookie });
  assert.equal(item(after, "command/propose").status, "in_sync");
  assert.deepEqual(after.data.summary, { local_only: 0, in_sync: 3, outdated: 0, modified: 0, registry_only: 1 });

  const viewerOwnAgent = await api(base, "PUT", "/api/v1/me/agents/mine", { files: toB64([{ path: "skills/bob-notes/SKILL.md", content: Buffer.from(LOCAL_NOTES.replace("local-notes", "bob-notes")) }]) }, { cookie: bob.cookie });
  assert.equal(viewerOwnAgent.status, 200);
  const forbidden = await api(base, "POST", "/api/v1/me/agents/mine/items/skill/bob-notes/publish", {}, { cookie: bob.cookie });
  assert.equal(forbidden.status, 403, "viewer cannot publish");
});

test("admin server agents: roots, scanning, rescanning, permissions, deletion", async () => {
  const runner = join(roots, "runner", ".claude");
  mkdirSync(join(runner, "skills"), { recursive: true });
  cpSync(join(FIXTURES, "skill-standard", "pdf-tools"), join(runner, "skills", "pdf-tools"), { recursive: true });
  mkdirSync(join(runner, "node_modules", "junk"), { recursive: true });
  writeFileSync(join(runner, "node_modules", "junk", "SKILL.md"), "---\nname: junk\ndescription: should be ignored\n---\n\nBody.\n");

  const notAdmin = await api(base, "POST", "/api/v1/admin/agents", { name: "ci-runner", server_path: runner }, { cookie: alice.cookie });
  assert.equal(notAdmin.status, 403);
  const created = await api(base, "POST", "/api/v1/admin/agents", { name: "ci-runner", server_path: runner, runtime: "claude-code" }, { cookie: admin.cookie });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.agent.kind, "server");
  assert.equal(created.data.agent.server_path, runner);
  assert.equal(created.data.items.length, 1);
  assert.equal(created.data.items[0].key, "skill/pdf-tools");
  assert.equal(created.data.items[0].status, "outdated");
  const id = created.data.agent.id;

  mkdirSync(join(runner, "commands"), { recursive: true });
  cpSync(join(FIXTURES, "command-propose", "propose.md"), join(runner, "commands", "propose.md"));
  const rescan = await api(base, "POST", `/api/v1/admin/agents/${id}/scan`, {}, { cookie: admin.cookie });
  assert.equal(rescan.status, 200, JSON.stringify(rescan.data));
  assert.deepEqual(rescan.data.items.map((i) => i.key).sort(), ["command/propose", "skill/pdf-tools"]);
  assert.equal(item(rescan, "command/propose").status, "outdated", "the registry already has propose 0.1.1");

  const mine = await api(base, "GET", "/api/v1/me/agents", undefined, { cookie: admin.cookie });
  assert.ok(mine.data.items.some((a) => a.name === "ci-runner" && a.kind === "server"), "server agent is visible to the admin owner");
  const adminList = await api(base, "GET", "/api/v1/admin/agents", undefined, { cookie: admin.cookie });
  const row = adminList.data.items.find((a) => a.id === id);
  assert.equal(row.owner.username, "admin");
  assert.equal(row.item_count, 2);

  const outside = await api(base, "POST", "/api/v1/admin/agents", { name: "evil", server_path: join(roots, "..", "outside") }, { cookie: admin.cookie });
  assert.equal(outside.status, 400);
  assert.equal(outside.data.error, "path_outside_roots");
  const traversal = await api(base, "POST", "/api/v1/admin/agents", { name: "evil2", server_path: join(roots, "runner", "..", "..", "..") }, { cookie: admin.cookie });
  assert.equal(traversal.status, 400);
  const missingDir = await api(base, "POST", "/api/v1/admin/agents", { name: "ghost", server_path: join(roots, "nope") }, { cookie: admin.cookie });
  assert.equal(missingDir.status, 404);
  const dup = await api(base, "POST", "/api/v1/admin/agents", { name: "ci-runner", server_path: runner }, { cookie: admin.cookie });
  assert.equal(dup.status, 409);

  // Roots in the list response; rescan by the owner.
  assert.equal(adminList.data.roots_enabled, true);
  assert.equal(adminList.data.roots.length, 1);
  assert.equal(realpathSync(adminList.data.roots[0]), realpathSync(roots));
  const ownerScan = await api(base, "POST", "/api/v1/me/agents/ci-runner/scan", {}, { cookie: admin.cookie });
  assert.equal(ownerScan.status, 200, JSON.stringify(ownerScan.data));
  assert.equal(ownerScan.data.agent.kind, "server");
  assert.equal(ownerScan.data.items.length, 2);
  const notServer = await api(base, "POST", "/api/v1/me/agents/laptop/scan", {}, { cookie: alice.cookie });
  assert.equal(notServer.status, 409);
  assert.equal(notServer.data.error, "not_server_agent");
  const foreign = await api(base, "POST", "/api/v1/me/agents/ci-runner/scan", {}, { cookie: alice.cookie });
  assert.equal(foreign.status, 404);

  const del = await api(base, "DELETE", `/api/v1/admin/agents/${id}`, undefined, { cookie: admin.cookie });
  assert.equal(del.status, 204);
  const gone = await api(base, "POST", `/api/v1/admin/agents/${id}/scan`, {}, { cookie: admin.cookie });
  assert.equal(gone.status, 404);
});

test("attack: junction/symlink inside the root pointing outside, on creation and on rescan", async () => {
  const linkType = process.platform === "win32" ? "junction" : "dir";
  const outsideReal = join(work, "outside-real", ".claude");
  mkdirSync(join(outsideReal, "skills"), { recursive: true });
  cpSync(join(FIXTURES, "skill-standard", "pdf-tools"), join(outsideReal, "skills", "pdf-tools"), { recursive: true });
  const escape = join(roots, "escape");
  symlinkSync(outsideReal, escape, linkType);
  const viaLink = await api(base, "POST", "/api/v1/admin/agents", { name: "escape", server_path: escape }, { cookie: admin.cookie });
  assert.equal(viaLink.status, 400, JSON.stringify(viaLink.data));
  assert.equal(viaLink.data.error, "path_outside_roots");
  const listed = await api(base, "GET", "/api/v1/admin/agents", undefined, { cookie: admin.cookie });
  assert.ok(!listed.data.items.some((a) => a.name === "escape"), "agent via junction must not be created");

  // The directory was legitimate at creation, then replaced by a junction pointing outside: rescan must refuse.
  const swap = join(roots, "swap");
  mkdirSync(join(swap, "skills"), { recursive: true });
  cpSync(join(FIXTURES, "skill-standard", "pdf-tools"), join(swap, "skills", "pdf-tools"), { recursive: true });
  const created = await api(base, "POST", "/api/v1/admin/agents", { name: "swap", server_path: swap }, { cookie: admin.cookie });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  rmSync(swap, { recursive: true, force: true });
  symlinkSync(outsideReal, swap, linkType);
  const rescan = await api(base, "POST", `/api/v1/admin/agents/${created.data.agent.id}/scan`, {}, { cookie: admin.cookie });
  assert.equal(rescan.status, 400, JSON.stringify(rescan.data));
  assert.equal(rescan.data.error, "path_outside_roots");
  const ownerRescan = await api(base, "POST", "/api/v1/me/agents/swap/scan", {}, { cookie: admin.cookie });
  assert.equal(ownerRescan.status, 400);
  assert.equal(ownerRescan.data.error, "path_outside_roots");
  const del = await api(base, "DELETE", `/api/v1/admin/agents/${created.data.agent.id}`, undefined, { cookie: admin.cookie });
  assert.equal(del.status, 204);
});

test("event agent.scanned reaches the plugin", async () => {
  const events = await until(async () => {
    const r = await api(base, "GET", "/api/v1/ext/agent-watch/events", undefined, { cookie: admin.cookie });
    return r.status === 200 && r.data.items.length >= 1 ? r.data.items : null;
  });
  assert.ok(events, "plugin agent-watch did not receive agent.scanned");
  const first = events.find((e) => e.agent.name === "laptop" && e.owner.username === "alice");
  assert.ok(first, JSON.stringify(events));
  assert.equal(first.type, "agent.scanned");
  assert.equal(first.agent.kind, "upload");
  assert.equal(first.agent.runtime, "claude-code");
  assert.equal(first.summary.local_only, 1);
  assert.equal(first.actor.username, "alice");
  assert.ok(events.some((e) => e.agent.name === "ci-runner" && e.agent.kind === "server"), "no event for the server agent");
});

test("agent deletion; roots disabled → 403; invalid root → server does not start", async () => {
  const del = await api(base, "DELETE", "/api/v1/me/agents/laptop", undefined, { cookie: alice.cookie });
  assert.equal(del.status, 204);
  const gone = await api(base, "GET", "/api/v1/me/agents/laptop", undefined, { cookie: alice.cookie });
  assert.equal(gone.status, 404);
  const list = await api(base, "GET", "/api/v1/me/agents", undefined, { cookie: alice.cookie });
  assert.deepEqual(list.data.items, []);

  const plain = await startServer({}, { prefix: "skillforge-agents-plain-" });
  assert.ok(plain.up, plain.stderr);
  try {
    const adm = await login(plain.base, "admin", ADMIN_PASSWORD);
    const r = await api(plain.base, "POST", "/api/v1/admin/agents", { name: "x", server_path: roots }, { cookie: adm.cookie });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, "agent_roots_disabled");
    const list = await api(plain.base, "GET", "/api/v1/admin/agents", undefined, { cookie: adm.cookie });
    assert.deepEqual(list.data.roots, []);
    assert.equal(list.data.roots_enabled, false);
  } finally {
    await plain.stop();
  }

  const badDir = mkdtempSync(join(tmpdir(), "skillforge-agents-bad-"));
  const port = await freePort();
  const r = await runNode([SERVER], { SKILLFORGE_AGENT_ROOTS: join(badDir, "does-not-exist"), SKILLFORGE_PORT: String(port), SKILLFORGE_DATA_DIR: badDir });
  assert.ok(r.code !== 0 && r.code !== null, `expected nonzero exit code: ${r.code} ${r.stderr}`);
  assert.ok(r.stderr.includes("SKILLFORGE_AGENT_ROOTS"), r.stderr);
  rmSync(badDir, { recursive: true, force: true });
});
