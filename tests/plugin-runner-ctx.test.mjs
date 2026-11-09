// The isolated process runner reaches a plugin
// through ctx.process rather than by importing @skillforge/core, so a plugin is loaded from the default plugins directory
// (<data_dir>/plugins) outside the repository tree. The contract is set by the fixtures
// tests/fixtures/plugins/runner-probe and runner-noperm.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { startServer, api, login, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const PLUGIN_FIXTURES = join(ROOT, "tests", "fixtures", "plugins");
const REVIEW_ASSISTANT = join(ROOT, "plugins", "review-assistant");
const SECRET = "runner-ctx-secret-7f3a";

let work;
let srv;
let admin;

before(async () => {
  // The data directory is in the OS temp folder — outside the repository tree, as in Docker (/data) and in any
  // non-local installation. SKILLFORGE_PLUGINS_DIR is NOT set: the default path is checked.
  work = mkdtempSync(join(tmpdir(), "skillforge-runner-ctx-"));
  const dataDir = join(work, "data");
  const pluginsDir = join(dataDir, "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  for (const name of ["runner-probe", "runner-noperm"]) {
    cpSync(join(PLUGIN_FIXTURES, name), join(pluginsDir, name), { recursive: true });
  }
  cpSync(REVIEW_ASSISTANT, join(pluginsDir, "review-assistant"), {
    recursive: true,
    filter: (src) => !/[\\/]node_modules([\\/]|$)/.test(src),
  });
  srv = await startServer(
    { SKILLFORGE_DATA_DIR: dataDir, SKILLFORGE_RUNNER_SECRET: SECRET },
    { prefix: "skillforge-runner-ctx-srv-" },
  );
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  await srv?.stop?.();
  if (work) rmSync(work, { recursive: true, force: true });
});

const pluginItem = (list, name) => list.data.items.find((p) => p.name === name);

test("plugins from <data_dir>/plugins outside the repository are loaded, including review-assistant", { timeout: 60_000 }, async () => {
  const list = await api(srv.base, "GET", "/api/v1/admin/plugins", undefined, admin);
  assert.equal(list.status, 200);
  for (const name of ["runner-probe", "runner-noperm", "review-assistant"]) {
    const p = pluginItem(list, name);
    assert.ok(p, `plugin ${name} not found: ${JSON.stringify(list.data)}`);
    assert.equal(p.status, "loaded", `${name}: ${p.status} ${p.error ?? ""}`);
  }
});

test("ctx.process.spawnIsolated: launch with stdin, SKILLFORGE_* does not reach the process in any letter case", { timeout: 60_000 }, async () => {
  const r = await api(srv.base, "GET", "/api/v1/ext/runner-probe/run", undefined, admin);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal(r.data.code, 0);
  assert.equal(r.data.timedOut, false);
  const out = JSON.parse(r.data.stdout);
  assert.equal(out.marker, "ran");
  assert.equal(out.input, "from-plugin");
  assert.equal(out.secret, null, "SKILLFORGE_RUNNER_SECRET reached the plugin process");
  assert.equal(out.lower, null, "the lowercase name gave access to SKILLFORGE_RUNNER_SECRET");
  assert.ok(!r.data.stdout.includes(SECRET));
});

test("ctx.process.spawnIsolated: the timeout kills the process and reports timedOut", { timeout: 60_000 }, async () => {
  const r = await api(srv.base, "GET", "/api/v1/ext/runner-probe/hang", undefined, admin);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.timedOut, true);
  assert.equal(r.data.ok, false);
  assert.ok(r.data.elapsed_ms < 15_000, `timeout is 1 s, but the response came after ${r.data.elapsed_ms} ms`);
});

test("without the process capability the runner is unavailable: the error names the capability, the process is not started", { timeout: 60_000 }, async () => {
  const r = await api(srv.base, "GET", "/api/v1/ext/runner-noperm/run", undefined, admin);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.spawned, false, `process started without the capability: ${JSON.stringify(r.data)}`);
  assert.match(r.data.error, /capabilit/i);
  assert.match(r.data.error, /process/);
});

test("built-in plugins do not import @skillforge/* — they depend only on ctx", () => {
  const bad = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === "node_modules") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|cjs)$/.test(name) && /from\s+["']@skillforge\/|require\(\s*["']@skillforge\//.test(readFileSync(p, "utf8"))) {
        bad.push(relative(ROOT, p));
      }
    }
  };
  walk(join(ROOT, "plugins"));
  assert.deepEqual(bad, []);
});
