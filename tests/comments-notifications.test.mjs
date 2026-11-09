// Acceptance tests for comments and notifications, part A.
// Requires `npm run build`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let base;
let work;
const U = {};
const auth = (who) => (who === "anon" ? {} : { cookie: U[who].cookie });
const api = (method, path, body, who = "admin") => rawApi(base, method, path, body, auth(who));
const A = "/api/v1/artifacts/skill/pdf-tools";
const skillFiles = loadDir(join(FIXTURES, "skill-standard"));
const variant = (name, extra = "") =>
  skillFiles.map((f) => ({
    path: f.path.replace("pdf-tools", name),
    content: f.path.endsWith("SKILL.md") ? Buffer.from(f.content.toString("utf8").replace(/^name: pdf-tools$/m, `name: ${name}`) + extra) : f.content,
  }));
const publish = (name, version, who, extra = "", body = {}) => api("POST", "/api/v1/artifacts", { type: "skill", version, files: toB64(variant(name, extra)), ...body }, who);
const comment = (path, body, who) => api("POST", `${path}/comments`, body, who);
const notifs = async (who, q = "") => (await api("GET", `/api/v1/me/notifications${q}`, undefined, who)).data;
const kindsFor = async (who, pred) => (await notifs(who, "?limit=200")).items.filter(pred).map((n) => n.kind).sort();
async function until(fn, { timeout = 5000, step = 100 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-comments-work-"));
  const pluginsDir = join(work, "plugins");
  cpSync(join(ROOT, "tests", "fixtures", "plugins", "notif-probe"), join(pluginsDir, "notif-probe"), { recursive: true });
  srv = await startServer({ SKILLFORGE_PLUGINS_DIR: pluginsDir }, { prefix: "skillforge-comments-" });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  base = srv.base;
  U.admin = await login(base, "admin", ADMIN_PASSWORD);
  const roles = { alice: "contributor", bob: "contributor", carol: "contributor", dave: "contributor", erin: "contributor", lena: "contributor", oscar: "contributor", mia: "viewer", vera: "viewer", rita: "reviewer", zed: "contributor" };
  for (const [u, role] of Object.entries(roles)) {
    await createUser(base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    U[u] = await login(base, u, `${u}-pw-123`);
  }
  assert.equal((await publish("pdf-tools", "0.1.0", "alice")).status, 201);
  assert.equal((await api("POST", `${A}/transitions`, { to: "active", reason: "go" }, "rita")).status, 200);
  assert.equal((await publish("other-skill", "0.1.0", "alice")).status, 201);
});

after(async () => {
  await srv?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("comments: threads under the root comment, version, bounds, permissions, limit, counter", async () => {
  const root = await comment(A, { body: "Question about 0.1.0", version: "0.1.0" }, "bob");
  assert.equal(root.status, 201, JSON.stringify(root.data));
  const c1 = root.data.comment;
  assert.equal(c1.author, "bob");
  assert.equal(c1.version, "0.1.0");
  const r1 = await comment(A, { body: "Answer", parent_id: c1.id }, "carol");
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  assert.equal(r1.data.comment.version, "0.1.0", "version is inherited");
  const r2 = await comment(A, { body: "Answer to answer", parent_id: r1.data.comment.id }, "dave");
  assert.equal(r2.data.comment.parent_id, c1.id, "a reply to a reply attaches to the root");

  const list = (await api("GET", `${A}/comments?version=0.1.0`, undefined, "anon")).data;
  assert.equal(list.items.length, 1);
  assert.deepEqual(list.items[0].replies.map((r) => r.author), ["carol", "dave"]);
  assert.equal((await api("GET", `${A}/comments?version=0.2.0`, undefined, "anon")).data.items.length, 0);

  const xss = await comment(A, { body: "<img src=x onerror=alert(1)> <b>x</b>" }, "erin");
  assert.equal(xss.data.comment.body, "<img src=x onerror=alert(1)> <b>x</b>", "text is stored and returned as is, not executed");

  for (const bad of [{ body: "" }, { body: "x".repeat(4001) }, { body: "nul\u0000" }, { body: 5 }, {}]) {
    const r = await comment(A, bad, "bob");
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 40));
    assert.equal(r.data.error, "comment_invalid");
  }
  assert.equal((await comment(A, { body: "x", version: "9.9.9" }, "bob")).status, 404);
  const other = await comment("/api/v1/artifacts/skill/other-skill", { body: "other" }, "bob");
  assert.equal((await comment(A, { body: "x", parent_id: other.data.comment.id }, "bob")).status, 404, "parent from another artifact");
  assert.equal((await comment(A, { body: "x" }, "anon")).status, 401);
  const t = await api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, "bob");
  const mcp = await rawApi(base, "POST", `${A}/comments`, { body: "x" }, { token: t.data.token });
  assert.equal(mcp.status, 403);
  assert.equal(mcp.data.error, "mcp_token_forbidden");
  assert.equal((await comment(A, { body: "viewers ask too" }, "vera")).status, 201, "a viewer can write");

  for (let i = 0; i < 30; i++) assert.equal((await comment("/api/v1/artifacts/skill/other-skill", { body: `spam ${i}` }, "zed")).status, 201);
  const over = await comment("/api/v1/artifacts/skill/other-skill", { body: "31st" }, "zed");
  assert.equal(over.status, 429);
  assert.equal(over.data.error, "rate_limited");
  assert.ok((await api("GET", A)).data.artifact.comments_count >= 5);
});

test("edit, soft delete, moderation with audit, counter", async () => {
  const c = (await comment(A, { body: "original" }, "bob")).data.comment;
  const before = (await api("GET", A)).data.artifact.comments_count;
  const edited = await api("PATCH", `/api/v1/comments/${c.id}`, { body: "fixed" }, "bob");
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.ok(edited.data.comment.edited_at);
  assert.equal((await api("PATCH", `/api/v1/comments/${c.id}`, { body: "hack" }, "carol")).status, 403);
  assert.equal((await api("PATCH", `/api/v1/comments/${c.id}`, { body: "" }, "bob")).status, 400);
  assert.equal((await api("DELETE", `/api/v1/comments/${c.id}`, undefined, "carol")).status, 403);
  assert.equal((await api("DELETE", `/api/v1/comments/${c.id}`, undefined, "anon")).status, 401);

  const parent = (await comment(A, { body: "thread root" }, "carol")).data.comment;
  await comment(A, { body: "reply stays", parent_id: parent.id }, "dave");
  assert.equal((await api("DELETE", `/api/v1/comments/${parent.id}`, undefined, "rita")).status, 200, "moderator");
  const tree = (await api("GET", `${A}/comments?limit=100`)).data.items.find((i) => i.id === parent.id);
  assert.equal(tree.deleted, true);
  assert.equal(tree.body, "");
  assert.equal(tree.replies.length, 1, "replies are kept");
  assert.ok((await api("GET", `${A}/audit`)).data.items.some((e) => e.action === "comment_delete" && e.actor === "rita"));
  assert.equal((await api("DELETE", `/api/v1/comments/${c.id}`, undefined, "bob")).status, 200, "the author deletes their own");
  assert.equal((await api("GET", A)).data.artifact.comments_count, before, "the counter does not count deleted ones");
});

test("mentions: existing users who can see the artifact are accepted; the rest are silently ignored", async () => {
  await api("PATCH", `/api/v1/admin/users/${(await api("GET", "/api/v1/admin/users")).data.items.find((u) => u.username === "oscar").id}`, { disabled: true });
  const r = await comment(A, { body: "cc @dave @nobody mail@erin @oscar and @vera" }, "bob");
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual([...r.data.comment.mentions].sort(), ["dave", "vera"], "not disabled, existing, not an e-mail");
  // restore oscar for the following tests
  await api("PATCH", `/api/v1/admin/users/${(await api("GET", "/api/v1/admin/users")).data.items.find((u) => u.username === "oscar").id}`, { disabled: false });
  U.oscar = await login(base, "oscar", "oscar-pw-123");
});

test("notifications: a new version goes to the owner, maintainer, watcher and the dependent via an agent snapshot; the publisher and an outsider get nothing", async () => {
  assert.equal((await api("POST", `${A}/maintainers`, { username: "bob" }, "alice")).status, 200);
  assert.equal((await api("PUT", `${A}/watch`, { watching: true }, "carol")).status, 200);
  assert.equal((await api("GET", A, undefined, "carol")).data.viewer.watching, true);
  assert.equal((await api("PUT", `${A}/watch`, { watching: true }, "anon")).status, 401);
  const snapshot = toB64(skillFiles.map((f) => ({ path: `skills/${f.path}`, content: f.content })));
  assert.equal((await api("PUT", "/api/v1/me/agents/laptop", { runtime: "claude-code", files: snapshot }, "dave")).status, 200);

  const beforeOscar = (await notifs("oscar", "?limit=200")).items.length;
  const pub = await publish("pdf-tools", "0.2.0", "bob", "\nSecond version.\n");
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  const has = (who) => kindsFor(who, (n) => n.kind === "new_version" && n.version === "0.2.0");
  assert.deepEqual(await has("alice"), ["new_version"], "owner");
  assert.deepEqual(await has("carol"), ["new_version"], "watcher");
  assert.deepEqual(await has("dave"), ["new_version"], "dependent via an agent snapshot");
  assert.deepEqual(await has("bob"), [], "publisher");
  assert.deepEqual(await has("erin"), ["new_version"], "a commenter is an auto-watcher (erin wrote a comment above)");
  assert.deepEqual(await has("oscar"), [], "an outsider who never commented and does not watch");
  assert.equal((await notifs("oscar", "?limit=200")).items.length, beforeOscar);
  const dn = (await notifs("dave", "?limit=200")).items.find((n) => n.kind === "new_version");
  assert.equal(dn.artifact.name, "pdf-tools");
  assert.equal(dn.actor, "bob");
  assert.equal(dn.read, false);
  assert.ok(typeof dn.title === "string" && dn.url.includes("pdf-tools"));
  assert.ok((await kindsFor("alice", (n) => n.kind === "status_change")).length >= 1, "the owner knows about the move to active");
});

test("notifications: a comment in a thread goes to the parent, owner, maintainer and watcher; the mentioned user gets a mention; deduplication; an edit does not notify", async () => {
  const root = (await comment(A, { body: "erin asks something" }, "erin")).data.comment;
  const hasCid = (id) => (n) => n.comment_id === id;
  const reply = await comment(A, { body: "carol answers @dave", parent_id: root.id }, "carol");
  assert.equal(reply.status, 201, JSON.stringify(reply.data));
  const cid = reply.data.comment.id;
  assert.deepEqual(await kindsFor("erin", hasCid(cid)), ["comment"], "author of the parent");
  assert.deepEqual(await kindsFor("alice", hasCid(cid)), ["comment"], "owner");
  assert.deepEqual(await kindsFor("bob", hasCid(cid)), ["comment"], "maintainer");
  assert.deepEqual(await kindsFor("dave", hasCid(cid)), ["mention"], "the mentioned user gets one mention, without a duplicate comment");
  assert.deepEqual(await kindsFor("carol", hasCid(cid)), [], "the author does not notify themselves");
  assert.deepEqual(await kindsFor("vera", hasCid(cid)), ["comment"], "vera commented earlier: auto-watcher");
  assert.deepEqual(await kindsFor("oscar", hasCid(cid)), [], "an outsider who never commented");
  const before = (await notifs("dave", "?limit=200")).items.length;
  assert.equal((await api("PATCH", `/api/v1/comments/${cid}`, { body: "carol answers @dave (edited)" }, "carol")).status, 200);
  assert.equal((await notifs("dave", "?limit=200")).items.length, before, "an edit without new mentions creates no notifications");
  assert.equal((await api("GET", A, undefined, "erin")).data.viewer.watching, true, "a commenter is an auto-watcher");
});

test("feed: reading, marking as read, other users' ids, cursor, type settings", async () => {
  const before = await notifs("dave");
  assert.ok(before.unread_count >= 2);
  assert.equal(before.items.every((n) => n.read === false || n.read === true), true);
  const ids = before.items.slice(0, 2).map((n) => n.id);
  assert.equal((await api("POST", "/api/v1/me/notifications/read", { ids }, "erin")).data.updated, 0, "other users' ids are ignored");
  const r = await api("POST", "/api/v1/me/notifications/read", { ids }, "dave");
  assert.equal(r.data.updated, 2);
  assert.equal((await notifs("dave")).unread_count, before.unread_count - 2);
  const page1 = await notifs("dave", "?limit=1");
  assert.equal(page1.items.length, 1);
  assert.ok(page1.next_cursor);
  const page2 = await notifs("dave", `?limit=1&cursor=${encodeURIComponent(page1.next_cursor)}`);
  assert.notEqual(page2.items[0].id, page1.items[0].id);
  assert.ok((await notifs("dave", "?unread=1")).items.every((n) => n.read === false));
  assert.equal((await api("POST", "/api/v1/me/notifications/read", { all: true }, "dave")).status, 200);
  assert.equal((await notifs("dave")).unread_count, 0);
  assert.equal((await api("GET", "/api/v1/me/notifications", undefined, "anon")).status, 401);
  assert.equal((await api("GET", "/api/v1/me/overview", undefined, "alice")).data.notifications.unread, (await notifs("alice")).unread_count);

  const prefs = await api("PUT", "/api/v1/me/notification-prefs", { new_version: false }, "carol");
  assert.equal(prefs.status, 200, JSON.stringify(prefs.data));
  assert.equal((await api("PUT", "/api/v1/me/notification-prefs", { mention: false }, "carol")).status, 400, "mention cannot be disabled");
  assert.equal((await api("GET", "/api/v1/me/notification-prefs", undefined, "carol")).data.new_version, false);
  assert.equal((await publish("pdf-tools", "0.3.0", "alice", "\nThird version.\n")).status, 201);
  assert.deepEqual(await kindsFor("carol", (n) => n.kind === "new_version" && n.version === "0.3.0"), [], "a disabled type does not arrive");
  assert.deepEqual(await kindsFor("dave", (n) => n.kind === "new_version" && n.version === "0.3.0"), ["new_version"]);
});

test("visibility: for a team artifact comments return 404 to an outsider, by :id too; notifications are hidden on read", async () => {
  assert.equal((await api("POST", "/api/v1/teams", { name: "alpha", lead: "lena" })).status, 201);
  assert.equal((await api("POST", "/api/v1/teams/alpha/members", { username: "mia" }, "lena")).status, 201);
  const H = "/api/v1/artifacts/skill/hidden-skill";
  assert.equal((await publish("hidden-skill", "0.1.0", "lena", "", { visibility: "team", owner_team: "alpha" })).status, 201);
  assert.equal((await api("PUT", `${H}/watch`, { watching: true }, "mia")).status, 200);
  assert.equal((await api("PUT", `${H}/watch`, { watching: true }, "oscar")).status, 404);
  const c = await comment(H, { body: "internal note @oscar @mia" }, "lena");
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.deepEqual(c.data.comment.mentions, ["mia"], "an outsider is not mentioned");
  assert.equal((await api("GET", `${H}/comments`, undefined, "oscar")).status, 404);
  assert.equal((await comment(H, { body: "x" }, "oscar")).status, 404);
  assert.equal((await api("PATCH", `/api/v1/comments/${c.data.comment.id}`, { body: "x" }, "oscar")).status, 404, "by :id it is also 404, not 403");
  assert.equal((await api("DELETE", `/api/v1/comments/${c.data.comment.id}`, undefined, "oscar")).status, 404);
  assert.equal((await api("GET", `${H}/comments`, undefined, "anon")).status, 404);
  assert.equal((await api("GET", `${H}/comments`, undefined, "mia")).status, 200);
  assert.deepEqual(await kindsFor("oscar", (n) => n.artifact?.name === "hidden-skill"), []);
  const mine = await kindsFor("mia", (n) => n.artifact?.name === "hidden-skill");
  assert.ok(mine.includes("mention"), JSON.stringify(mine));

  assert.equal((await api("DELETE", "/api/v1/teams/alpha/members/mia", undefined, "lena")).status, 200);
  assert.deepEqual(await kindsFor("mia", (n) => n.artifact?.name === "hidden-skill"), [], "after losing access, notifications are hidden on read");
  const after = await notifs("mia", "?unread=1");
  assert.ok(after.items.every((n) => n.artifact?.name !== "hidden-skill"));
});

test("plugins: comment.created and notification.created without the full text; ctx.notifications.send respects visibility", async () => {
  const long = "long text " + "y".repeat(500);
  const c = await comment(A, { body: `${long} @dave` }, "bob");
  assert.equal(c.status, 201);
  const events = async () => (await api("GET", "/api/v1/ext/notif-probe/events")).data.items;
  const created = await until(async () => (await events()).find((e) => e.type === "comment.created" && e.comment.id === c.data.comment.id));
  assert.ok(created, "the comment.created event was received");
  assert.equal(created.comment.author, "bob");
  assert.ok(created.comment.excerpt.length <= 200);
  assert.equal(created.comment.body, undefined, "the full text is not given to plugins");
  assert.ok(!JSON.stringify(created).includes("y".repeat(300)));
  assert.deepEqual(created.mentions, ["dave"]);
  const nc = await until(async () => (await events()).find((e) => e.type === "notification.created" && e.notification.username === "dave" && e.notification.kind === "mention"));
  assert.ok(nc, "the notification.created event was received");
  assert.equal(nc.notification.artifact.name, "pdf-tools");

  const send = (body) => api("POST", "/api/v1/ext/notif-probe/send", body, "admin");
  const ok = await send({ users: ["dave", "erin"], title: "Plugin says hi", text: "hello", artifact: { type: "skill", name: "pdf-tools" } });
  assert.equal(ok.data.sent, 2, JSON.stringify(ok.data));
  assert.deepEqual(await kindsFor("dave", (n) => n.kind === "plugin"), ["plugin"]);
  const hidden = await send({ users: ["lena", "oscar"], title: "Hidden hi", artifact: { type: "skill", name: "hidden-skill" } });
  assert.equal(hidden.data.sent, 1, "a recipient who cannot see the artifact is skipped");
  assert.deepEqual(await kindsFor("oscar", (n) => n.kind === "plugin" && n.title === "Hidden hi"), []);
  assert.equal((await send({ users: Array.from({ length: 21 }, (_, i) => `u${i}`), title: "x" })).status, 400, "at most 20 recipients");
  assert.equal((await send({ users: ["dave"], title: "t".repeat(121) })).status, 400, "title <= 120");
});

test("migration: tables exist, comments have no columns with HTML processing", async () => {
  const db = new DatabaseSync(join(srv.dataDir, "skillforge.db"), { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    for (const t of ["comments", "notifications", "artifact_watchers", "notification_prefs"]) assert.ok(tables.includes(t), `table ${t}`);
    const cols = db.prepare("PRAGMA table_info(comments)").all().map((c) => c.name);
    for (const c of ["body", "parent_id", "author", "version", "ref", "mentions", "created_at", "edited_at", "deleted_at"]) assert.ok(cols.includes(c), `comments.${c}`);
    assert.ok(!cols.some((c) => /html/i.test(c)));
  } finally {
    db.close();
  }
});

test("limit of 50 recipients: a mention is delivered first and is not cut off by watchers", async () => {
  // with more than 50 targets, mentions go to the front of the queue, not last.
  const C = "/api/v1/artifacts/skill/crowded-skill";
  assert.equal((await publish("crowded-skill", "0.1.0", "alice")).status, 201);
  const watchers = [];
  for (let i = 1; i <= 50; i++) {
    const u = `w${String(i).padStart(2, "0")}`;
    await createUser(base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role: "viewer" });
    U[u] = await login(base, u, `${u}-pw-123`);
    watchers.push(u);
  }
  for (const u of watchers) {
    assert.equal((await api("PUT", `${C}/watch`, { watching: true }, u)).status, 200, u);
  }
  const r = await comment(C, { body: "ping @zed" }, "bob");
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const cid = r.data.comment.id;
  const zedMentions = (await notifs("zed", "?limit=200")).items.filter((n) => n.comment_id === cid && n.kind === "mention");
  assert.equal(zedMentions.length, 1, "the mentioned user got the mention despite 50 watchers ahead");
});
