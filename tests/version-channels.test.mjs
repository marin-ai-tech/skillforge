// Version channels and pinning: pre-release channels, resolve, channel changes, CLI pin/sync/outdated.
// Requires `npm run build`.
// Runs AFTER the artifact-ownership change is merged (the right to change a channel = the right to publish a version).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
let srv;
let base;
let admin;
let alice; // owner
let bob; // another user's contributor
let vera; // viewer
let aliceToken;
let work;
const api = (method, path, body, who) => rawApi(base, method, path, body, who === null ? {} : { cookie: (who ?? admin).cookie });
const A = "/api/v1/artifacts/skill/pdf-tools";

const skillFiles = loadDir(join(FIXTURES, "skill-standard"));
const withExtra = (line) =>
  skillFiles.map((f) =>
    f.path.endsWith("SKILL.md") ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + `\n${line}\n`) } : f,
  );
const publish = (version, extra, body = {}, who = alice) =>
  api("POST", "/api/v1/artifacts", { type: "skill", version, files: toB64(withExtra(extra)), ...body }, who);
const card = async () => (await api("GET", A)).data;
const resolve = (spec, who) => api("GET", `${A}/resolve?spec=${encodeURIComponent(spec)}`, undefined, who);

function cli(args, into) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: base, SKILLFORGE_TOKEN: aliceToken },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 60000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr });
    });
  });
}
const lockOf = (into) => JSON.parse(readFileSync(join(into, ".skillforge-lock.json"), "utf8")).artifacts["skill/pdf-tools"];
const newInto = (name) => join(work, name, ".claude");

before(async () => {
  assert.ok(existsSync(CLI), `built CLI not found: ${CLI} — run npm run build`);
  srv = await startServer({}, { prefix: "skillforge-channels-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-123", role: "contributor" });
  await createUser(base, admin.cookie, { username: "bob", password: "bob-pw-123", role: "contributor" });
  await createUser(base, admin.cookie, { username: "vera", password: "vera-pw-123", role: "viewer" });
  alice = await login(base, "alice", "alice-pw-123");
  bob = await login(base, "bob", "bob-pw-123");
  vera = await login(base, "vera", "vera-pw-123");
  aliceToken = (await api("POST", "/api/v1/me/tokens", { name: "cli" }, alice)).data.token;
  work = mkdtempSync(join(tmpdir(), "skillforge-channels-work-"));
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("channels: pre-release → beta by default, explicit beta, invalid channel; beta does not become latest", async () => {
  for (const [v, x] of [["0.1.0", "v1"], ["0.2.0", "v2"]]) assert.equal((await publish(v, x)).status, 201);
  const b = await publish("0.3.0-beta.1", "b1");
  assert.equal(b.status, 201, JSON.stringify(b.data));
  assert.equal(b.data.version.channel, "beta");
  assert.equal((await publish("0.2.1", "v21", { channel: "beta" })).data.version.channel, "beta");
  for (const [v, ch] of [["0.4.0-rc.1", "stable"], ["0.4.1", "x"]]) {
    const r = await publish(v, `bad-${v}`, { channel: ch });
    assert.equal(r.status, 400, `${v}/${ch}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, "channel_invalid");
  }
  const c = await card();
  assert.equal(c.latest.version, "0.2.0");
  assert.equal(c.artifact.latest_version, "0.2.0");
  assert.equal(c.artifact.latest_channel, "stable");
  assert.equal(c.channels.stable.version, "0.2.0");
  assert.equal(c.channels.beta.version, "0.3.0-beta.1");
  const vs = (await api("GET", `${A}/versions`)).data.items;
  assert.deepEqual(Object.fromEntries(vs.map((v) => [v.version, v.channel])), { "0.1.0": "stable", "0.2.0": "stable", "0.2.1": "beta", "0.3.0-beta.1": "beta" });
});

test("distribution: marketplace.json takes stable; an explicit beta version is downloadable", async () => {
  assert.equal((await api("POST", `${A}/transitions`, { to: "active", reason: "channels test" })).status, 200);
  const mp = (await api("GET", "/marketplace.json", undefined, null)).data;
  const entry = JSON.stringify(mp.plugins.find((p) => p.name.includes("pdf-tools")));
  assert.ok(entry.includes("0.2.0"), entry);
  assert.ok(!entry.includes("0.3.0-beta.1"), entry);
  const bundle = await fetch(`${base}${A}/versions/0.3.0-beta.1/bundle.zip`, { headers: { cookie: alice.cookie } });
  assert.equal(bundle.status, 200);
});

test("resolve: spec grammar, ranges over stable, errors", async () => {
  const ok = { latest: "0.2.0", beta: "0.3.0-beta.1", "^0.2": "0.2.0", "=0.1.0": "0.1.0", "0.1.0": "0.1.0", ">=0.1.0 <0.2.0": "0.1.0" };
  for (const [spec, want] of Object.entries(ok)) {
    const r = await resolve(spec);
    assert.equal(r.status, 200, `${spec}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.version, want, spec);
    assert.match(r.data.digest, /^[0-9a-f]{64}$/);
    assert.ok(["stable", "beta"].includes(r.data.channel));
  }
  const none = await resolve("^9");
  assert.equal(none.status, 404);
  assert.equal(none.data.error, "no_matching_version");
  for (const spec of ["bogus", "^0.2; rm -rf /", "x".repeat(65), ""]) {
    const r = await resolve(spec);
    assert.equal(r.status, 400, `${spec}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, "spec_invalid");
  }
  // reading obeys SKILLFORGE_PUBLIC_READ (true by default), like the artifact card
  assert.equal((await resolve("latest", null)).status, 200, "anonymous resolve with public read");
  assert.equal((await api("GET", "/api/v1/artifacts/skill/nope/resolve?spec=latest")).status, 404);
});

test("channel change: promotion and rollback change latest, audit, permissions", async () => {
  const path = `${A}/versions/0.2.1/channel`;
  assert.equal((await api("POST", path, { channel: "stable" }, vera)).status, 403);
  assert.equal((await api("POST", path, { channel: "stable" }, bob)).status, 403, "another user's contributor");
  assert.equal((await api("POST", path, { channel: "stable" }, null)).status, 401);
  const badPre = await api("POST", `${A}/versions/0.3.0-beta.1/channel`, { channel: "stable" }, alice);
  assert.equal(badPre.status, 400);
  assert.equal(badPre.data.error, "channel_invalid");
  assert.equal((await api("POST", `${A}/versions/9.9.9/channel`, { channel: "stable" }, alice)).status, 404);

  const up = await api("POST", path, { channel: "stable", reason: "checked" }, alice);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.latest_version, "0.2.1");
  assert.equal((await card()).latest.version, "0.2.1");
  assert.equal((await resolve("latest")).data.version, "0.2.1");
  assert.equal((await api("POST", path, { channel: "stable" }, alice)).status, 200, "the same channel — idempotent");

  const down = await api("POST", path, { channel: "beta" }, alice);
  assert.equal(down.data.latest_version, "0.2.0");
  const ev = (await api("GET", `${A}/audit`)).data.items.filter((e) => e.action === "channel_change");
  assert.equal(ev.length, 2, JSON.stringify(ev));
  // the audit log returns new events first (as in lifecycle)
  assert.deepEqual(ev.map((e) => [e.meta.from, e.meta.to, e.meta.version]), [["stable", "beta", "0.2.1"], ["beta", "stable", "0.2.1"]]);
});

test("an MCP token does not change the channel", async () => {
  const t = await api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, alice);
  const r = await rawApi(base, "POST", `${A}/versions/0.2.1/channel`, { channel: "stable" }, { token: t.data.token });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "mcp_token_forbidden");
});

test("artifact only from beta: latest is beta with a mark", async () => {
  const files = skillFiles.map((f) => ({
    path: f.path.replace("pdf-tools", "beta-only"),
    content: f.path.endsWith("SKILL.md") ? Buffer.from(f.content.toString("utf8").replace(/^name: pdf-tools$/m, "name: beta-only")) : f.content,
  }));
  const r = await api("POST", "/api/v1/artifacts", { type: "skill", version: "0.1.0-beta.1", files: toB64(files) }, alice);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const c = (await api("GET", "/api/v1/artifacts/skill/beta-only")).data;
  assert.equal(c.latest.version, "0.1.0-beta.1");
  assert.equal(c.artifact.latest_channel, "beta");
});

test("CLI: pin by range, sync respects pin, outdated, unpin, beta, exact", async () => {
  const D = newInto("pin");
  mkdirSync(D, { recursive: true });
  let r = await cli(["install", "skill/pdf-tools@^0.1", "--into", D]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.equal(lockOf(D).version, "0.1.0");
  assert.equal(lockOf(D).pin, "^0.1");

  r = await cli(["sync", "--into", D, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const sum = JSON.parse(r.stdout);
  assert.ok(sum.up_to_date.some((x) => x.startsWith("skill/pdf-tools@0.1.0")), r.stdout);
  assert.equal(lockOf(D).version, "0.1.0", "pin keeps sync from updating to latest");

  r = await cli(["outdated", "--into", D, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const row = JSON.parse(r.stdout).find((x) => x.artifact === "skill/pdf-tools") ?? JSON.parse(r.stdout).items?.find((x) => x.artifact === "skill/pdf-tools");
  assert.deepEqual(
    { installed: row.installed, wanted: row.wanted, latest: row.latest, pin: row.pin, update_available: row.update_available, newer_than_pin: row.newer_than_pin },
    { installed: "0.1.0", wanted: "0.1.0", latest: "0.2.0", pin: "^0.1", update_available: false, newer_than_pin: true },
  );

  r = await cli(["install", "skill/pdf-tools@latest", "--into", D]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lockOf(D).version, "0.2.0");
  assert.equal(lockOf(D).pin, undefined, "@latest removes the pin");

  r = await cli(["install", "skill/pdf-tools@beta", "--into", D]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.equal(lockOf(D).version, "0.3.0-beta.1");
  assert.equal(lockOf(D).pin, "beta");

  // an exact pin below the installed version is a downgrade
  r = await cli(["install", "skill/pdf-tools@=0.2.0", "--into", D]);
  assert.equal(r.code, 5, r.stderr + r.stdout);
  assert.match(r.stderr + r.stdout, /would downgrade/);
  assert.equal(lockOf(D).version, "0.3.0-beta.1", "files and lock untouched");
  r = await cli(["install", "skill/pdf-tools@=0.2.0", "--into", D, "--allow-downgrade"]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.equal(lockOf(D).version, "0.2.0");
  assert.equal(lockOf(D).pin, "=0.2.0");

  // a new stable version does not move an exact pin; install without spec keeps the pin
  assert.equal((await publish("0.2.5", "v25")).status, 201);
  r = await cli(["sync", "--into", D]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lockOf(D).version, "0.2.0");
  r = await cli(["install", "skill/pdf-tools", "--into", D]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lockOf(D).pin, "=0.2.0");
  assert.equal(lockOf(D).version, "0.2.0");
});

test("CLI: sync does not downgrade silently; --allow-downgrade allows it", async () => {
  assert.equal((await api("POST", `${A}/versions/0.2.1/channel`, { channel: "stable" }, alice)).status, 200);
  assert.equal((await card()).latest.version, "0.2.5", "0.2.5 is higher than 0.2.1");
  // make 0.2.5 a beta, latest = 0.2.1; install 0.2.5 explicitly (without pin), then sync wants 0.2.1 < 0.2.5
  assert.equal((await api("POST", `${A}/versions/0.2.5/channel`, { channel: "beta" }, alice)).status, 200);
  const D = newInto("down");
  mkdirSync(D, { recursive: true });
  let r = await cli(["install", "skill/pdf-tools@=0.2.5", "--into", D]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const lock = JSON.parse(readFileSync(join(D, ".skillforge-lock.json"), "utf8"));
  delete lock.artifacts["skill/pdf-tools"].pin;
  writeFileSync(join(D, ".skillforge-lock.json"), JSON.stringify(lock, null, 2));
  r = await cli(["sync", "--into", D, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const skipped = JSON.parse(r.stdout).skipped.find((x) => x.artifact === "skill/pdf-tools");
  assert.match(skipped?.reason ?? "", /would downgrade 0.2.5 -> 0.2.1/);
  assert.equal(lockOf(D).version, "0.2.5");
  r = await cli(["sync", "--into", D, "--allow-downgrade", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lockOf(D).version, "0.2.1");
});

test("CLI: an invalid pin in the lock is ignored with a warning, exit code 0", async () => {
  const D = newInto("badpin");
  mkdirSync(D, { recursive: true });
  assert.equal((await cli(["install", "skill/pdf-tools@=0.2.1", "--into", D])).code, 0);
  const p = join(D, ".skillforge-lock.json");
  const lock = JSON.parse(readFileSync(p, "utf8"));
  lock.artifacts["skill/pdf-tools"].pin = "^0.2; rm -rf /";
  writeFileSync(p, JSON.stringify(lock, null, 2));
  const r = await cli(["sync", "--into", D]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(r.stderr, /ignored invalid pin/);
});
