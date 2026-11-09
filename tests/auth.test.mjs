// Acceptance tests for authentication, tokens and users. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, api, login, createUser, loadDir, toB64, FIXTURES, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let admin;

before(async () => {
  srv = await startServer();
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

const skillFiles = () => toB64(loadDir(join(FIXTURES, "skill-standard")));
const HAS_COOKIE = /sf_session=[^;]+;.*HttpOnly/i;

test("seed: admin from an environment variable, no password file created, health without a secret", async () => {
  assert.equal(admin.user.username, "admin");
  assert.equal(admin.user.role, "admin");
  assert.match(admin.setCookie, HAS_COOKIE);
  assert.ok(!existsSync(join(srv.dataDir, "initial-admin-password.txt")));
  const h = await api(base, "GET", "/api/v1/health");
  assert.ok(!JSON.stringify(h.data).includes(ADMIN_PASSWORD));
  for (const k of ["id", "username", "display_name", "role"]) assert.ok(k in admin.user, `no field ${k}`);
  assert.ok(!("password_hash" in admin.user));
});

test("login: wrong password → 401 invalid_credentials without a cookie; me without login → 401", async () => {
  const bad = await api(base, "POST", "/api/v1/auth/login", { username: "admin", password: "wrong-pw" });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.error, "invalid_credentials");
  assert.ok(!(bad.headers.get("set-cookie") ?? "").includes("sf_session="));
  const unknown = await api(base, "POST", "/api/v1/auth/login", { username: "nobody", password: "wrong-pw" });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.data.error, "invalid_credentials");
  const me = await api(base, "GET", "/api/v1/me");
  assert.equal(me.status, 401);
  assert.equal(me.data.error, "unauthorized");
});

test("me and logout", async () => {
  const s = await login(base, "admin", ADMIN_PASSWORD);
  const me = await api(base, "GET", "/api/v1/me", undefined, { cookie: s.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, "admin");
  const out = await api(base, "POST", "/api/v1/auth/logout", undefined, { cookie: s.cookie });
  assert.equal(out.status, 204);
  const after = await api(base, "GET", "/api/v1/me", undefined, { cookie: s.cookie });
  assert.equal(after.status, 401);
});

test("admin: creating users, roles, duplicate, weak password, non-admin → 403", async () => {
  const alice = await createUser(base, admin.cookie, { username: "alice", password: "alice-pw-1", role: "contributor", display_name: "Alice" });
  assert.equal(alice.username, "alice");
  assert.equal(alice.role, "contributor");
  assert.ok(!("password_hash" in alice));
  await createUser(base, admin.cookie, { username: "bob", password: "bob-pw-123", role: "viewer" });
  await createUser(base, admin.cookie, { username: "rita", password: "rita-pw-12", role: "reviewer" });

  const dup = await api(base, "POST", "/api/v1/admin/users", { username: "Alice", password: "alice-pw-2", role: "viewer" }, { cookie: admin.cookie });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.error, "username_taken");
  const weak = await api(base, "POST", "/api/v1/admin/users", { username: "weak", password: "12345", role: "viewer" }, { cookie: admin.cookie });
  assert.equal(weak.status, 400);
  assert.equal(weak.data.error, "bad_request");
  const badRole = await api(base, "POST", "/api/v1/admin/users", { username: "king", password: "king-pw-12", role: "superuser" }, { cookie: admin.cookie });
  assert.equal(badRole.status, 400);

  const list = await api(base, "GET", "/api/v1/admin/users", undefined, { cookie: admin.cookie });
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.items.map((u) => u.username).sort(), ["admin", "alice", "bob", "rita"]);

  const a = await login(base, "alice", "alice-pw-1");
  const forbidden = await api(base, "GET", "/api/v1/admin/users", undefined, { cookie: a.cookie });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.data.error, "forbidden");
  const anon = await api(base, "GET", "/api/v1/admin/users");
  assert.equal(anon.status, 401);
});

test("publish: anonymous 401, viewer 403, contributor 201 with published_by = username, the actor header is ignored", async () => {
  const anon = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: skillFiles() });
  assert.equal(anon.status, 401);
  assert.equal(anon.data.error, "unauthorized");
  const bob = await login(base, "bob", "bob-pw-123");
  const viewer = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: skillFiles() }, { cookie: bob.cookie });
  assert.equal(viewer.status, 403);
  assert.equal(viewer.data.error, "forbidden");
  const viewerValidate = await api(base, "POST", "/api/v1/artifacts/validate", { files: skillFiles() }, { cookie: bob.cookie });
  assert.equal(viewerValidate.status, 403);
  const h = await api(base, "GET", "/api/v1/health");
  assert.equal(h.data.artifacts, 0, "a publish without permission created an artifact");

  const alice = await login(base, "alice", "alice-pw-1");
  const ok = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files: skillFiles() }, { cookie: alice.cookie }, { "x-skillforge-actor": "mallory" });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.version.published_by, "alice");
  assert.equal(ok.data.artifact.created_by, "alice");
  const audit = await api(base, "GET", "/api/v1/artifacts/skill/pdf-tools/audit");
  assert.equal(audit.data.items[0].actor, "alice");
  const rita = await login(base, "rita", "rita-pw-12");
  const reviewerValidate = await api(base, "POST", "/api/v1/artifacts/validate", { files: skillFiles() }, { cookie: rita.cookie });
  assert.equal(reviewerValidate.status, 200, "reviewer inherits contributor permissions");
});

test("tokens: creation, Bearer publish, last_used_at, revocation → 401", async () => {
  const alice = await login(base, "alice", "alice-pw-1");
  const created = await api(base, "POST", "/api/v1/me/tokens", { name: "ci" }, { cookie: alice.cookie });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.match(created.data.token, /^sf_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
  assert.equal(created.data.name, "ci");
  const list = await api(base, "GET", "/api/v1/me/tokens", undefined, { cookie: alice.cookie });
  assert.equal(list.data.items.length, 1);
  assert.ok(!("token" in list.data.items[0]), "the token secret must not be returned in the list");
  assert.equal(list.data.items[0].last_used_at, null);

  const files = toB64(loadDir(join(FIXTURES, "skill-e2e")));
  const pub = await api(base, "POST", "/api/v1/artifacts", { type: "skill", files }, { token: created.data.token });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  assert.equal(pub.data.version.published_by, "alice");
  const me = await api(base, "GET", "/api/v1/me", undefined, { token: created.data.token });
  assert.equal(me.status, 200);
  const list2 = await api(base, "GET", "/api/v1/me/tokens", undefined, { cookie: alice.cookie });
  assert.ok(list2.data.items[0].last_used_at, "last_used_at was not updated");

  const del = await api(base, "DELETE", `/api/v1/me/tokens/${created.data.id}`, undefined, { cookie: alice.cookie });
  assert.equal(del.status, 204);
  const revoked = await api(base, "GET", "/api/v1/me", undefined, { token: created.data.token });
  assert.equal(revoked.status, 401);
  const garbage = await api(base, "GET", "/api/v1/me", undefined, { token: "sf_00000000_00000000000000000000000000000000" });
  assert.equal(garbage.status, 401);
});

test("disable: a disabled user loses the session and cannot log in (423); last_admin is protected", async () => {
  const bob = await login(base, "bob", "bob-pw-123");
  const users = await api(base, "GET", "/api/v1/admin/users", undefined, { cookie: admin.cookie });
  const bobId = users.data.items.find((u) => u.username === "bob").id;
  const adminId = users.data.items.find((u) => u.username === "admin").id;
  const dis = await api(base, "PATCH", `/api/v1/admin/users/${bobId}`, { disabled: true }, { cookie: admin.cookie });
  assert.equal(dis.status, 200);
  assert.equal(dis.data.disabled, true);
  const me = await api(base, "GET", "/api/v1/me", undefined, { cookie: bob.cookie });
  assert.equal(me.status, 401);
  const relogin = await api(base, "POST", "/api/v1/auth/login", { username: "bob", password: "bob-pw-123" });
  assert.equal(relogin.status, 423);
  assert.equal(relogin.data.error, "disabled");
  const self = await api(base, "PATCH", `/api/v1/admin/users/${adminId}`, { role: "viewer" }, { cookie: admin.cookie });
  assert.equal(self.status, 409);
  assert.equal(self.data.error, "last_admin");
});

test("password: a change invalidates other sessions; wrong current → 401", async () => {
  const s1 = await login(base, "alice", "alice-pw-1");
  const s2 = await login(base, "alice", "alice-pw-1");
  const wrong = await api(base, "POST", "/api/v1/me/password", { current: "nope-nope", next: "alice-pw-3" }, { cookie: s1.cookie });
  assert.equal(wrong.status, 401);
  const weak = await api(base, "POST", "/api/v1/me/password", { current: "alice-pw-1", next: "short" }, { cookie: s1.cookie });
  assert.equal(weak.status, 400);
  const ok = await api(base, "POST", "/api/v1/me/password", { current: "alice-pw-1", next: "alice-pw-2" }, { cookie: s1.cookie });
  assert.equal(ok.status, 204);
  assert.equal((await api(base, "GET", "/api/v1/me", undefined, { cookie: s1.cookie })).status, 200);
  assert.equal((await api(base, "GET", "/api/v1/me", undefined, { cookie: s2.cookie })).status, 401);
  await login(base, "alice", "alice-pw-2");
});

test("rate limit: after 10 failed attempts → 429 even with the correct password", async () => {
  await createUser(base, admin.cookie, { username: "carl", password: "carl-pw-123", role: "viewer" });
  for (let i = 0; i < 10; i++) {
    const r = await api(base, "POST", "/api/v1/auth/login", { username: "carl", password: "bad" });
    assert.equal(r.status, 401, `attempt ${i + 1}`);
  }
  const limited = await api(base, "POST", "/api/v1/auth/login", { username: "carl", password: "carl-pw-123" });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error, "rate_limited");
});

test("PUBLIC_READ=false: anonymous read 401, after login 200; health is open", async () => {
  const closed = await startServer({ SKILLFORGE_PUBLIC_READ: "false" }, { prefix: "skillforge-closed-" });
  assert.ok(closed.up, closed.stderr);
  try {
    const anon = await api(closed.base, "GET", "/api/v1/artifacts");
    assert.equal(anon.status, 401);
    const health = await api(closed.base, "GET", "/api/v1/health");
    assert.equal(health.status, 200);
    const a = await login(closed.base, "admin", ADMIN_PASSWORD);
    const ok = await api(closed.base, "GET", "/api/v1/artifacts", undefined, { cookie: a.cookie });
    assert.equal(ok.status, 200);
  } finally {
    await closed.stop();
  }
  const bad = await startServer({ SKILLFORGE_PUBLIC_READ: "maybe" }, { prefix: "skillforge-badcfg-" });
  assert.equal(bad.up, false);
  assert.ok(bad.stderr.includes("SKILLFORGE_PUBLIC_READ"), `stderr: ${bad.stderr}`);
});

test("seed without the variable: the password is printed and saved to a file, login works, changing the password deletes the file", async () => {
  const gen = await startServer({ SKILLFORGE_ADMIN_PASSWORD: "" }, { prefix: "skillforge-gen-" });
  assert.ok(gen.up, gen.stderr);
  try {
    // The password lives only in the file, which is removed when it is changed.
    const file = join(gen.dataDir, "initial-admin-password.txt");
    assert.ok(existsSync(file));
    const password = readFileSync(file, "utf8").trim();
    assert.ok(password.length >= 20);
    assert.match(gen.stdout, /Initial admin password written to .*initial-admin-password\.txt/);
    assert.ok(!gen.stdout.includes(password), "password in stdout");
    assert.ok(!gen.stderr.includes(password), "password in stderr");
    const logs = join(gen.dataDir, "logs");
    for (const name of existsSync(logs) ? readdirSync(logs) : []) {
      assert.ok(!readFileSync(join(logs, name), "utf8").includes(password), `password in log ${name}`);
    }
    const s = await login(gen.base, "admin", password);
    const ch = await api(gen.base, "POST", "/api/v1/me/password", { current: password, next: "new-admin-pw-1" }, { cookie: s.cookie });
    assert.equal(ch.status, 204);
    assert.ok(!existsSync(file), "the initial password file was not deleted after the change");
  } finally {
    await gen.stop();
  }
});
