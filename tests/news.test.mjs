// news: the registry-wide news. Automatic news is recorded with its event — a new artifact (first `active`), a new
// stable version (not the first), a status change (zombie, retired with its replacement, back to active); aging, beta
// and candidates make no news. Posts are written by an admin for everyone or a team, by a team lead for that team
// only. Every read filters by the reader's rights now: an artifact of another team, a purged one, a draft or a future
// post is not news for that reader. Negative cases sit next to each positive one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, api as rawApi, login, createUser, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
const who = {};
const api = (method, path, body, user = "admin") => rawApi(srv.base, method, path, body, user ? { cookie: who[user].cookie } : {});
const skill = (name, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: Does ${name} things. Use when ${name} is needed.\n---\n\n# ${name}\n\n${body}\n`;
const b64 = (s) => Buffer.from(s).toString("base64");
const A = (name) => `/api/v1/artifacts/skill/${name}`;

async function publish(user, name, version, extra = {}) {
  const r = await api("POST", "/api/v1/artifacts", { type: "skill", version, files: [{ path: `${name}/SKILL.md`, content_base64: b64(skill(name, `Version ${version}.`)) }], ...extra }, user);
  assert.equal(r.status, 201, `${name}@${version}: ${JSON.stringify(r.data)}`);
}
async function move(name, to, user = "rita") {
  const r = await api("POST", `${A(name)}/transitions`, { to, reason: "news test" }, user);
  assert.equal(r.status, 200, `${name} → ${to}: ${JSON.stringify(r.data)}`);
}
async function feed(user, query = "") {
  const r = await api("GET", `/api/v1/news${query}`, undefined, user);
  assert.equal(r.status, 200, `feed of ${user}: ${JSON.stringify(r.data)}`);
  return r.data;
}
const about = (items, name) => items.filter((i) => i.artifact?.name === name).map((i) => [i.kind, i.version ?? null, i.from ?? null, i.to ?? null]);
const titles = (items) => items.filter((i) => i.kind === "post").map((i) => i.post.title);
async function post(user, body) {
  return api("POST", "/api/v1/news/posts", { body: "Text.", ...body }, user);
}

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-news-" });
  assert.ok(srv.up, srv.stderr);
  who.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["rita", "reviewer"], ["carol", "contributor"], ["dave", "contributor"], ["mia", "contributor"]]) {
    await createUser(srv.base, who.admin.cookie, { username: u, password: `${u}-pw-123456`, role });
    who[u] = await login(srv.base, u, `${u}-pw-123456`);
  }
  // payments: carol leads, mia is a member; search: dave leads, carol is only a member
  assert.equal((await api("POST", "/api/v1/teams", { name: "payments", lead: "carol" })).status, 201);
  assert.equal((await api("POST", "/api/v1/teams/payments/members", { username: "mia" }, "carol")).status, 201);
  assert.equal((await api("POST", "/api/v1/teams", { name: "search", lead: "dave" })).status, 201);
  assert.equal((await api("POST", "/api/v1/teams/search/members", { username: "carol" }, "dave")).status, 201);
});

after(async () => {
  if (srv?.up) await srv.stop();
});

test("a new artifact is news once, on its first active; a candidate and aging are not news", async () => {
  await publish("alice", "pdf", "1.0.0");
  assert.deepEqual(about((await feed("dave")).items, "pdf"), [], "a candidate is not news");
  await move("pdf", "active");
  assert.deepEqual(about((await feed("dave")).items, "pdf"), [["new_artifact", null, null, null]]);
  await move("pdf", "aging");
  assert.deepEqual(about((await feed("dave")).items, "pdf"), [["new_artifact", null, null, null]], "aging is not news");
  await move("pdf", "active");
  assert.deepEqual(about((await feed("dave")).items, "pdf"), [
    ["status_change", null, "aging", "active"],
    ["new_artifact", null, null, null],
  ], "back to active is a status change, not a second new artifact");
});

test("a stable version is news, the first one and beta are not; nothing for a candidate", async () => {
  await publish("alice", "pdf", "1.1.0", { channel: "beta" });
  assert.equal(about((await feed("dave")).items, "pdf").filter(([k]) => k === "new_version").length, 0, "beta is not news");
  const promote = await api("POST", `${A("pdf")}/versions/1.1.0/channel`, { channel: "stable" }, "alice");
  assert.equal(promote.status, 200, JSON.stringify(promote.data));
  await publish("alice", "pdf", "1.2.0");
  const versions = about((await feed("dave")).items, "pdf").filter(([k]) => k === "new_version").map(([, v]) => v);
  assert.deepEqual(versions, ["1.2.0", "1.1.0"], "promotion to stable and a stable publication, newest first");
  await publish("alice", "draft-skill", "1.0.0");
  await publish("alice", "draft-skill", "1.1.0");
  assert.deepEqual(about((await feed("admin")).items, "draft-skill"), [], "versions of a candidate are not news");
});

test("zombie and retirement are news; retirement carries the replacement; return through candidate is a status change", async () => {
  await publish("alice", "pdf-old", "1.0.0");
  await move("pdf-old", "active");
  const rep = await api("PUT", `${A("pdf-old")}/replacement`, { replaced_by: "skill/pdf" }, "alice");
  assert.equal(rep.status, 200, JSON.stringify(rep.data));
  await move("pdf-old", "retired");
  const retired = (await feed("dave")).items.find((i) => i.artifact?.name === "pdf-old" && i.kind === "status_change");
  assert.deepEqual([retired?.from, retired?.to, retired?.replacement], ["active", "retired", { type: "skill", name: "pdf" }]);
  await publish("alice", "csv", "1.0.0");
  await move("csv", "active");
  await move("csv", "zombie");
  assert.deepEqual(about((await feed("dave")).items, "csv")[0], ["status_change", null, "active", "zombie"]);
  await move("csv", "retired");
  await move("csv", "candidate");
  assert.equal(about((await feed("dave")).items, "csv").length, 3, "retired → candidate is not news");
  await move("csv", "active");
  assert.deepEqual(about((await feed("dave")).items, "csv")[0], ["status_change", null, "candidate", "active"]);
  assert.equal(about((await feed("dave")).items, "csv").filter(([k]) => k === "new_artifact").length, 1);
});

test("posts: an admin writes for everyone or a team, a lead only for their team; fields are checked; changes are audited", async () => {
  assert.equal((await post("admin", { title: "Registry upgrade on Friday", pinned: true })).status, 201);
  const forPayments = await post("carol", { title: "Payments: new review rule", team: "payments" });
  assert.equal(forPayments.status, 201, JSON.stringify(forPayments.data));
  // negative cases: a team where carol is only a member, no team, no team role at all
  assert.equal((await post("carol", { title: "Search news", team: "search" })).status, 403);
  assert.equal((await post("carol", { title: "Everyone", team: undefined })).status, 403);
  assert.equal((await post("alice", { title: "Me too" })).status, 403);
  const created = await post("carol", { title: "Payments: release", team: "payments" });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.id;
  assert.equal((await api("PATCH", `/api/v1/news/posts/${id}`, { team: "search" }, "carol")).status, 403, "moving a post to a team she does not lead");
  assert.equal((await api("PATCH", `/api/v1/news/posts/${id}`, { title: "Payments: release 2" }, "carol")).status, 200);
  const later = new Date(Date.now() + 3600_000).toISOString();
  for (const bad of [
    { title: "" },
    { title: "x".repeat(201) },
    { title: "Long", body: "y".repeat(20001) },
    { title: "Nowhere", team: "no-such-team" },
    { title: "Too late", publish_at: new Date(Date.now() + 366 * 86400_000).toISOString() },
    { title: "Backwards", publish_at: later, expires_at: new Date().toISOString() },
  ]) {
    assert.equal((await post("admin", bad)).status, 400, JSON.stringify(bad).slice(0, 80));
  }
  assert.equal((await api("DELETE", `/api/v1/news/posts/${id}`, undefined, "admin")).status, 200);
  const audit = (await api("GET", "/api/v1/admin/audit?limit=200")).data.items.map((e) => e.action);
  for (const action of ["news_post_create", "news_post_update", "news_post_delete"]) assert.ok(audit.includes(action), `${action} not in the audit journal`);
});

test("reading follows the reader's rights now: another team's artifact and post, a purged artifact, a draft and a future post", async () => {
  await publish("mia", "ledger", "1.0.0", { visibility: "team", owner_team: "payments" });
  await move("ledger", "active");
  for (const [user, sees] of [["mia", true], ["carol", true], ["admin", true], ["dave", false], ["alice", false]]) {
    const f = await feed(user);
    assert.equal(about(f.items, "ledger").length > 0, sees, `${user} and the news about ledger`);
    assert.equal(titles(f.items).includes("Payments: new review rule"), sees, `${user} and the post for payments`);
  }
  // the visibility changes, the news follows without touching it
  await publish("alice", "open-skill", "1.0.0");
  await move("open-skill", "active");
  assert.equal(about((await feed("dave")).items, "open-skill").length, 1);
  assert.equal((await api("PUT", `${A("open-skill")}/scope`, { visibility: "team", owner_team: "payments" })).status, 200);
  assert.equal(about((await feed("dave")).items, "open-skill").length, 0, "the news went with the visibility");
  // a purged artifact: only an admin still sees its news
  assert.equal((await api("POST", `${A("pdf-old")}/purge`, { confirm: "skill/pdf-old", reason: "news acceptance test" })).status, 200);
  assert.equal(about((await feed("dave")).items, "pdf-old").length, 0);
  assert.ok(about((await feed("admin")).items, "pdf-old").length > 0);
  // a draft and a future post: only for those who may edit them
  assert.equal((await post("carol", { title: "Payments: draft", team: "payments", draft: true })).status, 201);
  assert.equal((await post("admin", { title: "Next hour", publish_at: new Date(Date.now() + 3600_000).toISOString() })).status, 201);
  for (const user of ["mia", "dave"]) {
    const t = titles((await feed(user)).items);
    assert.ok(!t.includes("Payments: draft") && !t.includes("Next hour"), `${user} sees a draft or a future post: ${t}`);
  }
  const drafts = (await feed("admin", "?drafts=true")).items.filter((i) => i.kind === "post");
  assert.equal(drafts.find((i) => i.post.title === "Next hour")?.post.scheduled, true);
  assert.ok((await feed("carol", "?drafts=true")).items.some((i) => i.post?.title === "Payments: draft"));
  assert.ok(!(await feed("mia", "?drafts=true")).items.some((i) => i.post?.title === "Payments: draft"), "a member is not an editor");
});

test("filters, pages and pinned posts", async () => {
  const posts = (await feed("mia", "?kind=post")).items;
  assert.ok(posts.length > 0 && posts.every((i) => i.kind === "post"));
  const team = (await feed("mia", "?team=payments")).items;
  assert.ok(team.some((i) => i.artifact?.name === "ledger") && team.some((i) => i.post?.team === "payments"));
  assert.ok(!team.some((i) => i.artifact?.name === "pdf"), "an artifact without the team is not in the team filter");
  const mine = (await feed("alice", "?mine=true")).items;
  assert.ok(mine.length > 0 && mine.every((i) => ["pdf", "draft-skill", "csv", "open-skill"].includes(i.artifact?.name)), JSON.stringify(mine.map((i) => i.artifact?.name)));
  const first = await feed("dave", "?limit=2");
  assert.equal(first.items.length, 2);
  assert.ok(first.next_cursor);
  const second = await feed("dave", `?limit=2&cursor=${encodeURIComponent(first.next_cursor)}`);
  assert.ok(second.items.length > 0 && !second.items.some((i) => first.items.some((j) => j.id === i.id)));
  assert.deepEqual(first.pinned.map((p) => p.post.title), ["Registry upgrade on Friday"]);
  assert.deepEqual(second.pinned, [], "pinned posts come with the first page only");
});

test("unread: newer than the reader's mark, without the reader's own actions and without what they cannot see", async () => {
  assert.equal((await api("POST", "/api/v1/news/seen", {}, "alice")).status, 200);
  assert.equal((await feed("alice")).unread_count, 0);
  await publish("alice", "pdf", "1.3.0"); // her own action
  await publish("mia", "ledger", "1.1.0", { visibility: "team", owner_team: "payments" }); // not visible to alice
  await publish("dave", "grep", "1.0.0");
  await move("grep", "active"); // rita's action, visible to alice
  assert.equal((await feed("alice")).unread_count, 1);
  // the mark only grows and never passes the newest news
  assert.equal((await api("POST", "/api/v1/news/seen", { at: "2001-01-01T00:00:00.000Z" }, "alice")).status, 200);
  assert.equal((await feed("alice")).unread_count, 1, "the mark went back");
  assert.equal((await api("POST", "/api/v1/news/seen", { at: "2999-01-01T00:00:00.000Z" }, "alice")).status, 200);
  await move("grep", "aging");
  await move("grep", "active");
  assert.equal((await feed("alice")).unread_count, 1, "a mark in the future hid newer news");
});

test("without signing in: only org artifacts and posts for everyone; no unread mark", async () => {
  const anon = await rawApi(srv.base, "GET", "/api/v1/news");
  assert.equal(anon.status, 200, JSON.stringify(anon.data));
  assert.equal(anon.data.unread_count, 0);
  assert.ok(!anon.data.items.some((i) => i.artifact?.name === "ledger" || i.post?.team), "a team's news without signing in");
  assert.ok(anon.data.items.some((i) => i.artifact?.name === "pdf"));
  assert.equal((await rawApi(srv.base, "POST", "/api/v1/news/seen", {})).status, 401);
  assert.equal((await rawApi(srv.base, "POST", "/api/v1/news/posts", { title: "x", body: "y" })).status, 401);
});

test("a post's Markdown is stored and returned as written, never turned into HTML", async () => {
  const body = "Read [this](javascript:alert(1)) and <script>alert(2)</script>.";
  const r = await post("admin", { title: "Markdown", body });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const got = (await api("GET", `/api/v1/news/posts/${r.data.id}`, undefined, "dave")).data;
  assert.equal(got.post?.body ?? got.body, body);
});
