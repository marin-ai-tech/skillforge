// Plugin platform. Requires `npm run build`.
// The context API contract is defined by the fixture plugins in tests/fixtures/plugins/*.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD, freePort } from "./lib/client.mjs";

const PLUGIN_FIXTURES = join(ROOT, "tests", "fixtures", "plugins");
const SERVER = join(ROOT, "packages", "server", "dist", "index.js");

let work;
let pluginsDir;
let dataDir;
let srv;
let base;
let admin;
let bob;
let rita;
let aliceToken;

async function until(fn, { timeout = 5000, step = 100 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}

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

async function boot(extraEnv = {}) {
  const s = await startServer({ SKILLFORGE_PLUGINS_DIR: pluginsDir, SKILLFORGE_DATA_DIR: dataDir, ...extraEnv }, { prefix: "skillforge-plugins-" });
  assert.ok(s.up, `server did not start: ${s.stderr}`);
  return s;
}

const pluginItem = (list, name) => list.data.items.find((p) => p.name === name);

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-plugins-work-"));
  pluginsDir = join(work, "plugins");
  dataDir = join(work, "data");
  // Only the fixtures of this test: the tests/fixtures/plugins/ directory is shared with other tests.
  for (const name of ["api-mismatch", "bad-index", "bad-table", "broken", "hello", "leaky", "name-mismatch", "webhook"]) {
    cpSync(join(PLUGIN_FIXTURES, name), join(pluginsDir, name), { recursive: true });
  }
  mkdirSync(dataDir, { recursive: true });
  srv = await boot();
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor" });
  await createUser(base, admin.cookie, { username: "bob", password: "bob-pw-123", role: "viewer" });
  await createUser(base, admin.cookie, { username: "rita", password: "rita-pw-123", role: "reviewer" });
  bob = await login(base, "bob", "bob-pw-123");
  rita = await login(base, "rita", "rita-pw-123");
  const alice = await login(base, "alice", "alice-pw-1");
  aliceToken = (await api(base, "POST", "/api/v1/me/tokens", { name: "t" }, { cookie: alice.cookie })).data.token;
});

after(async () => {
  if (srv?.up) await srv.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("loading: plugin statuses, error isolation, health, list permissions", async () => {
  const anon = await api(base, "GET", "/api/v1/admin/plugins");
  assert.equal(anon.status, 401);
  const viewer = await api(base, "GET", "/api/v1/admin/plugins", undefined, { cookie: bob.cookie });
  assert.equal(viewer.status, 403);
  const list = await api(base, "GET", "/api/v1/admin/plugins", undefined, { cookie: admin.cookie });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.dir, pluginsDir);
  assert.equal(list.data.disabled, false);
  assert.deepEqual(list.data.items.map((p) => p.name).sort(), ["api-mismatch", "bad-index", "bad-table", "broken", "hello", "leaky", "name-mismatch", "webhook"]);
  const hello = pluginItem(list, "hello");
  assert.equal(hello.status, "loaded");
  assert.equal(hello.version, "1.0.0");
  assert.equal(hello.enabled, true);
  assert.equal(hello.restart_required, false);
  assert.equal(hello.error, null);
  assert.deepEqual(hello.capabilities, ["routes", "events", "db", "ui"]);
  assert.ok(hello.contributions.routes >= 1, JSON.stringify(hello.contributions));
  assert.equal(hello.contributions.nav, 1);
  assert.equal(hello.contributions.tabs, 2);
  assert.deepEqual([...hello.contributions.events].sort(), ["artifact.published", "artifact.transitioned", "server.started"]);
  assert.deepEqual(hello.config, { greeting: "Hello from config", shout: false });
  assert.equal(hello.config_schema.properties.greeting.type, "string");
  assert.equal(pluginItem(list, "webhook").status, "loaded");
  const broken = pluginItem(list, "broken");
  assert.equal(broken.status, "error");
  assert.ok(broken.error.includes("boom"), broken.error);
  const badTable = pluginItem(list, "bad-table");
  assert.equal(badTable.status, "error");
  assert.ok(/ext_bad-table_/.test(badTable.error), badTable.error);
  const mismatch = pluginItem(list, "api-mismatch");
  assert.equal(mismatch.status, "error");
  assert.ok(/api/i.test(mismatch.error), mismatch.error);
  const nameMismatch = pluginItem(list, "name-mismatch");
  assert.equal(nameMismatch.status, "error");
  assert.ok(/name/i.test(nameMismatch.error), nameMismatch.error);
  const badIndex = pluginItem(list, "bad-index");
  assert.equal(badIndex.status, "error", "CREATE UNIQUE INDEX without a prefix must be rejected");
  assert.ok(badIndex.error.includes("foo_unique") && /ext_bad[-_]index_/.test(badIndex.error), badIndex.error);
  const leaky = pluginItem(list, "leaky");
  assert.equal(leaky.status, "error");
  assert.ok(leaky.error.includes("boom after subscribing"), leaky.error);
  assert.deepEqual(leaky.contributions, { routes: 0, nav: 0, tabs: 0, events: [] }, "the contribution of a failed plugin is rolled back");
  const health = await api(base, "GET", "/api/v1/health");
  assert.deepEqual(health.data.plugins, { loaded: 2, errors: 6, disabled: 0 });
});

test("plugin routes: prefix /api/v1/ext/<name>, 401 by default, public, roles, 404 for foreign ones", async () => {
  const anon = await api(base, "GET", "/api/v1/ext/hello/ping");
  assert.equal(anon.status, 401);
  const viewer = await api(base, "GET", "/api/v1/ext/hello/ping", undefined, { cookie: bob.cookie });
  assert.equal(viewer.status, 200, JSON.stringify(viewer.data));
  assert.deepEqual(viewer.data, { pong: true, greeting: "Hello from config", plugin: "hello" });
  const viaToken = await api(base, "GET", "/api/v1/ext/hello/ping", undefined, { token: aliceToken });
  assert.equal(viaToken.status, 200);
  const pub = await api(base, "GET", "/api/v1/ext/hello/public");
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.data, { ok: true, anonymous: true });
  const adminOnlyViewer = await api(base, "GET", "/api/v1/ext/hello/admin-only", undefined, { cookie: bob.cookie });
  assert.equal(adminOnlyViewer.status, 403);
  const adminOnly = await api(base, "GET", "/api/v1/ext/hello/admin-only", undefined, { cookie: admin.cookie });
  assert.equal(adminOnly.status, 200);
  assert.deepEqual(adminOnly.data, { ok: true, role: "admin" });
  const unknownPlugin = await api(base, "GET", "/api/v1/ext/nope/x", undefined, { cookie: admin.cookie });
  assert.equal(unknownPlugin.status, 404);
  assert.equal(unknownPlugin.data.error, "not_found");
  const brokenRoute = await api(base, "GET", "/api/v1/ext/broken/anything", undefined, { cookie: admin.cookie });
  assert.equal(brokenRoute.status, 404);
  const leakyRoute = await api(base, "GET", "/api/v1/ext/leaky/x");
  assert.equal(leakyRoute.status, 404, "routes of a failed plugin are not registered");
});

test("configuration: schema defaults, PATCH without restart, validation 422, 404, 403", async () => {
  const patch = await api(base, "PATCH", "/api/v1/admin/plugins/hello", { config: { greeting: "Hi", shout: true } }, { cookie: admin.cookie });
  assert.equal(patch.status, 200, JSON.stringify(patch.data));
  assert.deepEqual(patch.data.config, { greeting: "Hi", shout: true });
  assert.equal(patch.data.restart_required, false);
  const ping = await api(base, "GET", "/api/v1/ext/hello/ping", undefined, { cookie: bob.cookie });
  assert.equal(ping.data.greeting, "HI");
  const partial = await api(base, "PATCH", "/api/v1/admin/plugins/hello", { config: { greeting: "Hello again" } }, { cookie: admin.cookie });
  assert.equal(partial.status, 200);
  assert.deepEqual(partial.data.config, { greeting: "Hello again", shout: false }, "schema defaults are applied to missing fields");
  const bad = await api(base, "PATCH", "/api/v1/admin/plugins/hello", { config: { greeting: 5 } }, { cookie: admin.cookie });
  assert.equal(bad.status, 422, JSON.stringify(bad.data));
  assert.equal(bad.data.error, "config_invalid");
  assert.ok(Array.isArray(bad.data.issues) && bad.data.issues.length >= 1 && /greeting/.test(JSON.stringify(bad.data.issues)));
  const unknownKey = await api(base, "PATCH", "/api/v1/admin/plugins/hello", { config: { greeting: "x", extra: 1 } }, { cookie: admin.cookie });
  assert.equal(unknownKey.status, 422, "unknown config keys are rejected");
  const notObject = await api(base, "PATCH", "/api/v1/admin/plugins/hello", { config: "nope" }, { cookie: admin.cookie });
  assert.equal(notObject.status, 422);
  const missing = await api(base, "PATCH", "/api/v1/admin/plugins/nope", { config: {} }, { cookie: admin.cookie });
  assert.equal(missing.status, 404);
  const forbidden = await api(base, "PATCH", "/api/v1/admin/plugins/hello", { config: {} }, { cookie: bob.cookie });
  assert.equal(forbidden.status, 403);
  const after = await api(base, "GET", "/api/v1/ext/hello/ping", undefined, { cookie: bob.cookie });
  assert.equal(after.data.greeting, "Hello again");
});

test("migrations and events: counter after publish, payload published/transitioned/server.started", async () => {
  const before = await api(base, "GET", "/api/v1/ext/hello/count", undefined, { cookie: bob.cookie });
  assert.deepEqual(before.data, { count: 0 });
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: toB64(loadDir(join(FIXTURES, "skill-standard"))) }, { token: aliceToken });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const counted = await until(async () => (await api(base, "GET", "/api/v1/ext/hello/count", undefined, { cookie: bob.cookie })).data.count === 1);
  assert.ok(counted, "the artifact.published handler did not increase the counter");
  const events = await api(base, "GET", "/api/v1/ext/hello/events", undefined, { cookie: bob.cookie });
  const published = events.data.items.find((e) => e.type === "artifact.published");
  assert.ok(published, JSON.stringify(events.data));
  assert.equal(published.payload.type, "artifact.published");
  assert.ok(!Number.isNaN(Date.parse(published.payload.at)));
  assert.equal(published.payload.actor.username, "alice");
  assert.equal(published.payload.artifact.type, "skill");
  assert.equal(published.payload.artifact.name, "pdf-tools");
  assert.equal(published.payload.artifact.status, "candidate");
  assert.ok(typeof published.payload.artifact.id === "string" && published.payload.artifact.id.length > 0);
  assert.equal(published.payload.version.version, "0.1.0");
  assert.match(published.payload.version.digest, /^[0-9a-f]{64}$/);
  assert.ok(events.data.items.some((e) => e.type === "server.started"), "no server.started");
  assert.ok(!existsSync(join(pluginsDir, "leaky", "RAN.txt")), "the event handler of the failed leaky plugin ran");

  const tr = await api(base, "POST", "/api/v1/artifacts/skill/pdf-tools/transitions", { to: "active", reason: "Reviewed" }, { cookie: rita.cookie });
  assert.equal(tr.status, 200, JSON.stringify(tr.data));
  const transitioned = await until(async () => {
    const r = await api(base, "GET", "/api/v1/ext/hello/events", undefined, { cookie: bob.cookie });
    return r.data.items.find((e) => e.type === "artifact.transitioned");
  });
  assert.ok(transitioned, "no artifact.transitioned event");
  assert.equal(transitioned.payload.from, "candidate");
  assert.equal(transitioned.payload.to, "active");
  assert.equal(transitioned.payload.reason, "Reviewed");
  assert.equal(transitioned.payload.actor.username, "rita");
  assert.equal(transitioned.payload.artifact.status, "active");
});

test("webhook: the url config applies immediately, events are delivered by POST with the x-skillforge-event header", async () => {
  const received = [];
  const sink = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      received.push({ header: req.headers["x-skillforge-event"], body: JSON.parse(body) });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((r) => sink.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${sink.address().port}/hook`;
    const patch = await api(base, "PATCH", "/api/v1/admin/plugins/webhook", { config: { url } }, { cookie: admin.cookie });
    assert.equal(patch.status, 200, JSON.stringify(patch.data));
    assert.deepEqual(patch.data.config, { url, events: ["artifact.published", "artifact.transitioned"] });
    const bad = await api(base, "PATCH", "/api/v1/admin/plugins/webhook", { config: { url: 5 } }, { cookie: admin.cookie });
    assert.equal(bad.status, 422);
    const pub = await api(base, "POST", "/api/v1/artifacts", { type: "command", files: toB64(loadDir(join(FIXTURES, "command-propose"))) }, { token: aliceToken });
    assert.equal(pub.status, 201, JSON.stringify(pub.data));
    const got = await until(async () => received.find((r) => r.body.artifact?.name === "propose" && r.body.type === "artifact.published"));
    assert.ok(got, `webhook did not receive artifact.published: ${JSON.stringify(received)}`);
    assert.equal(got.header, "artifact.published");
    assert.equal(got.body.artifact.type, "command");
    assert.equal(got.body.version.version, "0.1.0");
    const tr = await api(base, "POST", "/api/v1/artifacts/command/propose/transitions", { to: "active" }, { cookie: rita.cookie });
    assert.equal(tr.status, 200);
    const gotTr = await until(async () => received.find((r) => r.body.type === "artifact.transitioned" && r.body.artifact?.name === "propose"));
    assert.ok(gotTr, "webhook did not receive artifact.transitioned");
    assert.equal(gotTr.header, "artifact.transitioned");
    assert.equal(gotTr.body.from, "candidate");
    assert.equal(gotTr.body.to, "active");
  } finally {
    await new Promise((r) => sink.close(r));
  }
});

test("UI contribution and registry facade: /api/v1/plugins/ui, page, tab, active list, file read", async () => {
  const ui = await api(base, "GET", "/api/v1/plugins/ui");
  assert.equal(ui.status, 200, "reading the UI contribution is public with SKILLFORGE_PUBLIC_READ by default");
  assert.deepEqual(ui.data.nav, [{ plugin: "hello", id: "about", label: "Hello", path: "/ext/hello/about" }]);
  assert.deepEqual(ui.data.artifact_tabs, [
    { plugin: "hello", id: "greeting", label: "Greeting" },
    { plugin: "hello", id: "async-greeting", label: "Async greeting" },
  ]);
  assert.ok(!ui.data.nav.some((n) => n.plugin === "leaky"), "the contribution of a failed plugin is not shown");
  const page = await api(base, "GET", "/api/v1/plugins/ui/pages/hello/about");
  assert.equal(page.status, 200);
  assert.equal(page.data.title, "About Hello");
  assert.ok(page.data.markdown.includes("Published so far: 2"), page.data.markdown);
  const missingPage = await api(base, "GET", "/api/v1/plugins/ui/pages/hello/nope");
  assert.equal(missingPage.status, 404);
  const missingPlugin = await api(base, "GET", "/api/v1/plugins/ui/pages/broken/about");
  assert.equal(missingPlugin.status, 404);
  const tab = await api(base, "GET", "/api/v1/plugins/ui/tabs/hello/greeting/skill/pdf-tools");
  assert.equal(tab.status, 200, JSON.stringify(tab.data));
  assert.ok(tab.data.markdown.includes("**skill/pdf-tools**") && tab.data.markdown.includes("0.1.0"), tab.data.markdown);
  assert.ok(tab.data.markdown.startsWith("Hello again"), "the tab reads the current config");
  const missingTab = await api(base, "GET", "/api/v1/plugins/ui/tabs/hello/nope/skill/pdf-tools");
  assert.equal(missingTab.status, 404);
  const missingArtifact = await api(base, "GET", "/api/v1/plugins/ui/tabs/hello/greeting/skill/nope");
  assert.equal(missingArtifact.status, 404);
  const asyncPage = await api(base, "GET", "/api/v1/plugins/ui/pages/hello/async");
  assert.equal(asyncPage.status, 200, JSON.stringify(asyncPage.data));
  assert.equal(asyncPage.data.title, "Async page");
  assert.ok(asyncPage.data.markdown.includes("published so far: 2"), asyncPage.data.markdown);
  const asyncTab = await api(base, "GET", "/api/v1/plugins/ui/tabs/hello/async-greeting/skill/pdf-tools");
  assert.equal(asyncTab.status, 200, JSON.stringify(asyncTab.data));
  assert.equal(asyncTab.data.markdown, "async hello, **skill/pdf-tools**");
  const leakyPage = await api(base, "GET", "/api/v1/plugins/ui/pages/leaky/leak");
  assert.equal(leakyPage.status, 404);

  const active = await api(base, "GET", "/api/v1/ext/hello/active", undefined, { cookie: bob.cookie });
  assert.deepEqual(active.data.names.sort(), ["command/propose", "skill/pdf-tools"]);
  const md = await api(base, "GET", "/api/v1/ext/hello/skill-md/pdf-tools", undefined, { cookie: bob.cookie });
  assert.equal(md.status, 200, JSON.stringify(md.data));
  assert.equal(md.data.version, "0.1.0");
  assert.match(md.data.digest, /^[0-9a-f]{64}$/);
  assert.ok(md.data.text.includes("name: pdf-tools"), md.data.text.slice(0, 80));
  const mdMissing = await api(base, "GET", "/api/v1/ext/hello/skill-md/nope", undefined, { cookie: bob.cookie });
  assert.equal(mdMissing.status, 404);
});

test("disabling requires a restart; after a restart migrations are not repeated, state is preserved", async () => {
  const off = await api(base, "PATCH", "/api/v1/admin/plugins/hello", { enabled: false }, { cookie: admin.cookie });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.enabled, false);
  assert.equal(off.data.status, "loaded");
  assert.equal(off.data.restart_required, true);
  const stillUp = await api(base, "GET", "/api/v1/ext/hello/ping", undefined, { cookie: bob.cookie });
  assert.equal(stillUp.status, 200, "plugin routes keep working until the restart");
  const eventsBefore = (await api(base, "GET", "/api/v1/ext/hello/events", undefined, { cookie: bob.cookie })).data.items.length;

  await srv.stop();
  srv = await boot();
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  bob = await login(base, "bob", "bob-pw-123");
  const list = await api(base, "GET", "/api/v1/admin/plugins", undefined, { cookie: admin.cookie });
  const hello = pluginItem(list, "hello");
  assert.equal(hello.status, "disabled");
  assert.equal(hello.enabled, false);
  assert.equal(hello.restart_required, false);
  const gone = await api(base, "GET", "/api/v1/ext/hello/ping", undefined, { cookie: bob.cookie });
  assert.equal(gone.status, 404);
  const ui = await api(base, "GET", "/api/v1/plugins/ui");
  assert.deepEqual(ui.data.nav, []);
  assert.deepEqual(ui.data.artifact_tabs, []);
  const health = await api(base, "GET", "/api/v1/health");
  assert.deepEqual(health.data.plugins, { loaded: 1, errors: 6, disabled: 1 });
  assert.ok(!existsSync(join(pluginsDir, "leaky", "RAN.txt")), "the server.started handler of the failed plugin ran after the restart");

  const on = await api(base, "PATCH", "/api/v1/admin/plugins/hello", { enabled: true }, { cookie: admin.cookie });
  assert.equal(on.status, 200);
  assert.equal(on.data.restart_required, true);
  await srv.stop();
  srv = await boot();
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  bob = await login(base, "bob", "bob-pw-123");
  rita = await login(base, "rita", "rita-pw-123");
  const back = pluginItem(await api(base, "GET", "/api/v1/admin/plugins", undefined, { cookie: admin.cookie }), "hello");
  assert.equal(back.status, "loaded");
  assert.equal(back.error, null);
  assert.deepEqual(back.config, { greeting: "Hello again", shout: false }, "config survives a restart");
  const count = await api(base, "GET", "/api/v1/ext/hello/count", undefined, { cookie: bob.cookie });
  assert.deepEqual(count.data, { count: 2 }, "migration 0001 must not recreate/reset the counter");
  const events = await until(async () => {
    const r = await api(base, "GET", "/api/v1/ext/hello/events", undefined, { cookie: bob.cookie });
    return r.data.items.length >= eventsBefore + 1 ? r.data.items : null;
  });
  assert.ok(events, "after the restart a new server.started event was expected, with the old ones preserved");
  assert.equal(events.filter((e) => e.type === "server.started").length, 2);
});

test("kill-switch, missing default directory and an invalid variable", async () => {
  const off = await startServer({ SKILLFORGE_PLUGINS_DIR: pluginsDir, SKILLFORGE_PLUGINS_DISABLED: "true" }, { prefix: "skillforge-plugins-off-" });
  assert.ok(off.up, off.stderr);
  try {
    const adm = await login(off.base, "admin", ADMIN_PASSWORD);
    const list = await api(off.base, "GET", "/api/v1/admin/plugins", undefined, { cookie: adm.cookie });
    assert.equal(list.status, 200);
    assert.equal(list.data.disabled, true);
    assert.deepEqual(list.data.items, []);
    const health = await api(off.base, "GET", "/api/v1/health");
    assert.deepEqual(health.data.plugins, { loaded: 0, errors: 0, disabled: 0 });
    const ext = await api(off.base, "GET", "/api/v1/ext/hello/public");
    assert.equal(ext.status, 404);
  } finally {
    await off.stop();
  }

  const plain = await startServer({}, { prefix: "skillforge-plugins-plain-" });
  assert.ok(plain.up, plain.stderr);
  try {
    const adm = await login(plain.base, "admin", ADMIN_PASSWORD);
    const list = await api(plain.base, "GET", "/api/v1/admin/plugins", undefined, { cookie: adm.cookie });
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.items, []);
    assert.equal(list.data.disabled, false);
    assert.ok(/plugins$/.test(list.data.dir.replace(/[\\/]+$/, "")), list.data.dir);
    assert.ok(list.data.dir.startsWith(plain.dataDir), `the default directory is inside data_dir: ${list.data.dir}`);
    const health = await api(plain.base, "GET", "/api/v1/health");
    assert.deepEqual(health.data.plugins, { loaded: 0, errors: 0, disabled: 0 });
    const ui = await api(plain.base, "GET", "/api/v1/plugins/ui");
    assert.deepEqual(ui.data, { nav: [], artifact_tabs: [] });
  } finally {
    await plain.stop();
  }

  const badDir = mkdtempSync(join(tmpdir(), "skillforge-plugins-bad-"));
  const port = await freePort();
  const r = await runNode([SERVER], { SKILLFORGE_PLUGINS_DISABLED: "maybe", SKILLFORGE_PORT: String(port), SKILLFORGE_DATA_DIR: badDir });
  assert.ok(r.code !== 0 && r.code !== null, `expected a non-zero exit code: ${r.code} ${r.stderr}`);
  assert.ok(r.stderr.includes("SKILLFORGE_PLUGINS_DISABLED"), r.stderr);
  rmSync(badDir, { recursive: true, force: true });
  assert.ok(!existsSync(join(pluginsDir, "hello", "node_modules")), "the platform must not write into the plugin directory");
});
