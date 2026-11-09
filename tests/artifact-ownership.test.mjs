// Acceptance tests for artifact ownership. Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let admin;
let alice; // contributor, owner
let bob; // contributor, not the owner
let carol; // contributor, future maintainer
let rita; // reviewer
let vera; // viewer
const api = (method, path, body, who) => rawApi(base, method, path, body, { cookie: (who ?? admin).cookie });

const skillFiles = loadDir(join(FIXTURES, "skill-standard"));
const withExtra = (line) =>
  skillFiles.map((f) =>
    f.path.endsWith("SKILL.md") ? { path: f.path, content: Buffer.from(f.content.toString("utf8") + `\n${line}\n`) } : f,
  );
const publishV = (who, version, extra, body = {}) =>
  api("POST", "/api/v1/artifacts", { type: "skill", version, files: toB64(withExtra(extra)), ...body }, who);
const detail = async (who) => (await api("GET", "/api/v1/artifacts/skill/pdf-tools", undefined, who ?? admin)).data.artifact;
const audit = async () => (await api("GET", "/api/v1/artifacts/skill/pdf-tools/audit")).data.items;

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-ownership-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const [username, role] of [["alice", "contributor"], ["bob", "contributor"], ["carol", "contributor"], ["rita", "reviewer"], ["vera", "viewer"]]) {
    await createUser(base, admin.cookie, { username, password: `${username}-pw-123`, role });
  }
  alice = await login(base, "alice", "alice-pw-123");
  bob = await login(base, "bob", "bob-pw-123");
  carol = await login(base, "carol", "carol-pw-123");
  rita = await login(base, "rita", "rita-pw-123");
  vera = await login(base, "vera", "vera-pw-123");
});

after(async () => {
  await srv?.stop();
});

test("the first publish assigns the owner; owner/created_by in the body are ignored", async () => {
  const r = await publishV(alice, "0.1.0", "v1", { owner: "bob", created_by: "bob", maintainers: ["bob"] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const a = await detail();
  assert.equal(a.owner, "alice");
  assert.equal(a.created_by, "alice");
  assert.deepEqual(a.maintainers, []);
  const list = await api("GET", "/api/v1/artifacts?type=skill");
  assert.equal(list.data.items.find((i) => i.name === "pdf-tools").owner, "alice");
});

test("a foreign contributor cannot publish a new version: 403 not_owner, no versions added", async () => {
  const before = (await detail()).versions_count;
  const r = await publishV(bob, "0.2.0", "bob-edit");
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "not_owner");
  assert.equal(r.data.owner, "alice");
  assert.equal((await detail()).versions_count, before);
});

test("viewer still cannot publish", async () => {
  const r = await publishV(vera, "0.2.0", "vera-edit");
  assert.equal(r.status, 403);
});

test("a foreign contributor publishes a new artifact with a different name freely and becomes its owner", async () => {
  const files = skillFiles.map((f) => ({
    path: f.path.replace("pdf-tools", "bob-skill"),
    content: f.path.endsWith("SKILL.md") ? Buffer.from(f.content.toString("utf8").replace(/^name: pdf-tools$/m, "name: bob-skill")) : f.content,
  }));
  const r = await api("POST", "/api/v1/artifacts", { type: "skill", files: toB64(files) }, bob);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await api("GET", "/api/v1/artifacts/skill/bob-skill")).data.artifact.owner, "bob");
});

test("the owner adds a maintainer; the maintainer publishes, the owner does not change; audit", async () => {
  const add = await api("POST", "/api/v1/artifacts/skill/pdf-tools/maintainers", { username: "carol" }, alice);
  assert.equal(add.status, 200, JSON.stringify(add.data));
  assert.deepEqual((await detail()).maintainers, ["carol"]);
  const again = await api("POST", "/api/v1/artifacts/skill/pdf-tools/maintainers", { username: "carol" }, alice);
  assert.equal(again.status, 200, "adding again is idempotent");
  const r = await publishV(carol, "0.2.0", "carol-edit");
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal((await detail()).owner, "alice");
  assert.ok((await audit()).some((e) => e.action === "maintainer_add" && e.actor === "alice"));
});

test("managing maintainers: a foreign user, a maintainer and a reviewer get 403; invalid recipients get 422", async () => {
  for (const who of [bob, carol, rita]) {
    const r = await api("POST", "/api/v1/artifacts/skill/pdf-tools/maintainers", { username: "bob" }, who);
    assert.equal(r.status, 403, `${who.user.username}: ${JSON.stringify(r.data)}`);
  }
  for (const username of ["vera", "nobody", "alice"]) {
    const r = await api("POST", "/api/v1/artifacts/skill/pdf-tools/maintainers", { username }, alice);
    assert.equal(r.status, 422, `${username}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, "maintainer_invalid");
  }
});

test("removing a maintainer closes publishing; audit maintainer_remove", async () => {
  const del = await api("DELETE", "/api/v1/artifacts/skill/pdf-tools/maintainers/carol", undefined, alice);
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.deepEqual((await detail()).maintainers, []);
  assert.equal((await publishV(carol, "0.3.0", "carol-again")).status, 403);
  assert.ok((await audit()).some((e) => e.action === "maintainer_remove"));
});

test("reviewer and admin publish into a foreign artifact with a publish_override record", async () => {
  const r = await publishV(rita, "0.3.0", "rita-fix");
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const a = await publishV(admin, "0.4.0", "admin-fix");
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const ov = (await audit()).filter((e) => e.action === "publish_override");
  assert.deepEqual(ov.map((e) => e.actor).sort(), ["admin", "rita"]);
  assert.equal(ov[0].meta.owner, "alice");
  assert.ok(["reviewer", "admin"].includes(ov[0].meta.by_role));
  assert.equal((await detail()).owner, "alice");
});

test("ownership transfer: permissions, reason, recipient, audit", async () => {
  const path = "/api/v1/artifacts/skill/pdf-tools/owner";
  assert.equal((await api("POST", path, { owner: "bob", reason: "x" }, bob)).status, 403);
  assert.equal((await api("POST", path, { owner: "bob", reason: "x" }, rita)).status, 403, "reviewer does not manage ownership");
  assert.equal((await api("POST", path, { owner: "bob" }, alice)).status, 400, "reason is required");
  assert.equal((await api("POST", path, { owner: "bob", reason: "  " }, alice)).status, 400);
  for (const owner of ["vera", "nobody"]) {
    const r = await api("POST", path, { owner, reason: "x" }, alice);
    assert.equal(r.status, 422);
    assert.equal(r.data.error, "owner_invalid");
  }
  assert.equal((await detail()).owner, "alice");

  await api("POST", "/api/v1/artifacts/skill/pdf-tools/maintainers", { username: "bob" }, alice);
  const ok = await api("POST", path, { owner: "bob", reason: "left the project" }, alice);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const a = await detail();
  assert.equal(a.owner, "bob");
  assert.equal(a.created_by, "alice", "created_by is unchanged");
  assert.ok(!a.maintainers.includes("bob"), "the new owner is removed from maintainers");
  const ev = (await audit()).find((e) => e.action === "owner_transfer");
  assert.equal(ev.actor, "alice");
  assert.equal(ev.reason, "left the project");
  assert.deepEqual([ev.meta.from, ev.meta.to], ["alice", "bob"]);
  assert.equal((await publishV(alice, "0.5.0", "alice-late")).status, 403, "the previous owner no longer publishes");
  assert.equal((await publishV(bob, "0.5.0", "bob-owner")).status, 201);
});

test("admin transfers a foreign artifact; a disabled user cannot become the owner", async () => {
  const path = "/api/v1/artifacts/skill/pdf-tools/owner";
  const off = await api("PATCH", `/api/v1/admin/users/${(await api("GET", "/api/v1/admin/users")).data.items.find((u) => u.username === "carol").id}`, { disabled: true });
  assert.ok([200, 204].includes(off.status), `disabling carol: ${off.status}`);
  const bad = await api("POST", path, { owner: "carol", reason: "x" });
  assert.equal(bad.status, 422);
  const ok = await api("POST", path, { owner: "alice", reason: "returned by an admin" });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await detail()).owner, "alice");
});

test("the My artifacts cabinet counts by owner", async () => {
  const me = await api("GET", "/api/v1/me/overview", undefined, alice);
  assert.equal(me.status, 200);
  assert.ok(me.data.artifacts.items.some((i) => i.name === "pdf-tools"));
  const bobMe = await api("GET", "/api/v1/me/overview", undefined, bob);
  assert.ok(!bobMe.data.artifacts.items.some((i) => i.name === "pdf-tools"), "after the return pdf-tools does not belong to bob");
});

// --- hardening ---

test("not_owner is checked before version conflicts: a foreign user learns nothing about existing versions and digests", async () => {
  const dup = await publishV(bob, "0.1.0", "v1"); // existing version and the same digest
  assert.equal(dup.status, 403, JSON.stringify(dup.data));
  assert.equal(dup.data.error, "not_owner");
  const exists = await publishV(bob, "0.1.0", "other-content"); // existing version, different digest
  assert.equal(exists.status, 403);
  assert.equal(exists.data.error, "not_owner");
});

test("a maintainer name is normalized to the canonical users.username form; letter case does not break idempotency", async () => {
  const add = await api("POST", "/api/v1/artifacts/skill/pdf-tools/maintainers", { username: "BOB" }, alice);
  assert.equal(add.status, 200, JSON.stringify(add.data));
  assert.deepEqual((await detail()).maintainers, ["bob"]);
  assert.equal((await api("POST", "/api/v1/artifacts/skill/pdf-tools/maintainers", { username: "Bob" }, alice)).status, 200);
  assert.deepEqual((await detail()).maintainers, ["bob"]);
  assert.equal((await publishV(bob, "0.6.0", "bob-maintainer")).status, 201);
});

test("only the owner and admin can remove maintainers; transferring to the owner itself is invalid", async () => {
  for (const who of [bob, rita, vera]) {
    const r = await api("DELETE", "/api/v1/artifacts/skill/pdf-tools/maintainers/bob", undefined, who);
    assert.equal(r.status, 403, `${who.user.username}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.error, "forbidden");
  }
  // not signed in and a disabled user (session revoked) get 401, not 403: authentication comes before authorization
  assert.equal((await rawApi(base, "DELETE", "/api/v1/artifacts/skill/pdf-tools/maintainers/bob", undefined, {})).status, 401);
  assert.equal((await api("DELETE", "/api/v1/artifacts/skill/pdf-tools/maintainers/bob", undefined, carol)).status, 401, "carol is disabled");
  const self = await api("POST", "/api/v1/artifacts/skill/pdf-tools/owner", { owner: "alice", reason: "x" }, alice);
  assert.equal(self.status, 422);
  assert.equal(self.data.error, "owner_invalid");
  assert.equal((await api("DELETE", "/api/v1/artifacts/skill/pdf-tools/maintainers/bob", undefined, alice)).status, 200);
});

test("an MCP token is not accepted by mutating ownership routes: 403 mcp_token_forbidden", async () => {
  const t = await api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, admin);
  assert.equal(t.status, 201, JSON.stringify(t.data));
  const tok = { token: t.data.token };
  const own = await rawApi(base, "POST", "/api/v1/artifacts/skill/pdf-tools/owner", { owner: "bob", reason: "x" }, tok);
  assert.equal(own.status, 403, JSON.stringify(own.data));
  assert.equal(own.data.error, "mcp_token_forbidden");
  const mt = await rawApi(base, "POST", "/api/v1/artifacts/skill/pdf-tools/maintainers", { username: "carol" }, tok);
  assert.equal(mt.status, 403);
  assert.equal(mt.data.error, "mcp_token_forbidden");
  assert.equal((await detail()).owner, "alice");
});

test("validate reports a not_owner conflict for a foreign artifact", async () => {
  const r = await api("POST", "/api/v1/artifacts/validate", { type: "skill", files: toB64(withExtra("probe")) }, bob);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.conflicts.includes("not_owner"), JSON.stringify(r.data.conflicts));
  const own = await api("POST", "/api/v1/artifacts/validate", { type: "skill", files: toB64(withExtra("probe")) }, alice);
  assert.ok(!own.data.conflicts.includes("not_owner"));
});

test("the My artifacts activity feed follows the owner", async () => {
  const me = await api("GET", "/api/v1/me/overview", undefined, alice);
  const feed = JSON.stringify(me.data);
  assert.match(feed, /owner_transfer|publish_override|maintainer_add/, "alice's artifact events are visible in her feed");
});

test("migration 0011 on a 0010 database: owner is matched case-insensitively, orphans go to admin with an audit record, created_by does not change", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readdirSync, readFileSync } = await import("node:fs");
  const { ROOT } = await import("./lib/client.mjs");
  const dir = join(ROOT, "packages", "server", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const f of files.filter((n) => n < "0011")) db.exec(readFileSync(join(dir, f), "utf8"));
  const now = new Date().toISOString();
  const user = (id, name, role, ts) =>
    db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at, updated_at) VALUES (?, ?, NULL, 'x', ?, 0, ?, ?)").run(id, name, role, ts, ts);
  user("u1", "root", "admin", "2026-01-01T00:00:00Z");
  user("u2", "alice", "contributor", "2026-01-02T00:00:00Z");
  const art = (id, name, createdBy) =>
    db.prepare("INSERT INTO artifacts (id, type, name, description, tags, status, visibility, created_by, created_at, updated_at) VALUES (?, 'skill', ?, 'd', '[]', 'active', 'org', ?, ?, ?)").run(id, name, createdBy, now, now);
  art("a1", "one", "Alice");
  art("a2", "two", "ghost");
  art("a3", "three", "anonymous");
  const file = files.find((n) => n.startsWith("0011_"));
  assert.ok(file, "no migration 0011_*.sql");
  db.exec(readFileSync(join(dir, file), "utf8"));
  const owners = Object.fromEntries(db.prepare("SELECT name, owner, created_by FROM artifacts").all().map((r) => [r.name, r]));
  assert.equal(owners.one.owner, "alice", "case normalized to users.username");
  assert.equal(owners.two.owner, "root", "orphan → first admin");
  assert.equal(owners.three.owner, "root");
  assert.equal(owners.one.created_by, "Alice", "created_by is unchanged");
  const ev = db.prepare("SELECT artifact_id, action, reason FROM audit_events WHERE action = 'owner_transfer' ORDER BY artifact_id").all();
  assert.deepEqual(ev.map((e) => e.artifact_id), ["a2", "a3"]);
  assert.ok(ev.every((e) => /migration 0011/.test(e.reason)));
  const cols = db.prepare("PRAGMA table_info(artifacts)").all().find((c) => c.name === "owner");
  assert.ok(cols, "owner column");
  db.close();
});
