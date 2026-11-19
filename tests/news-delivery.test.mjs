// news-delivery: news reaches people and tools outside the web page. Plugins get `news.published` once per item —
// an automatic item and a post at once, a scheduled post when its time comes, also across a restart; a draft and a
// post deleted before its time never. The summary (`news_summary` notification and `news.summary` event) holds the
// news of the period the reader may see, without their own actions; an empty one is not sent; one per period across a
// restart. The Atom feed follows the rights of the feed; its personal key opens only the feed, is shown once, is
// replaced and revoked, and never reaches the request log. `GET /api/v1/news` takes `since` and `unread=true` and
// tells the reader's `seen_at`. The tick runs every SKILLFORGE_NEWS_TICK_MS (500 ms here); summary periods are found
// by moving news times back in the database, not by changing the server clock.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startServer, api as rawApi, login, createUser, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

const TICK = { SKILLFORGE_NEWS_TICK_MS: "500" };
let work;
let dataDir;
let pluginsDir;
let srv;
let sink;
const received = [];
const who = {};
const pw = (u) => `${u}-pw-123456`;
const api = (method, path, body, user = "admin") => rawApi(srv.base, method, path, body, user ? { cookie: who[user].cookie } : {});
const b64 = (s) => Buffer.from(s).toString("base64");
const skill = (name, v) => `---\nname: ${name}\ndescription: Does ${name} things. Use when ${name} is needed.\n---\n\n# ${name}\n\nVersion ${v}.\n`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secretOf = (key) => key.split("_").slice(2).join("_");

async function until(fn, timeout = 8000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return v;
    await sleep(100);
  }
}

async function boot(env = TICK) {
  srv = await startServer({ SKILLFORGE_PLUGINS_DIR: pluginsDir, ...env }, { dataDir });
  assert.ok(srv.up, `server did not start: ${srv.stderr}`);
  who.admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  for (const u of ["alice", "rita", "carol", "mia", "dave", "zoe"]) {
    if (who[u]) who[u] = await login(srv.base, u, pw(u));
  }
}
async function restart(env = TICK) {
  await srv.stop();
  await boot(env);
}

async function publish(user, name, version, extra = {}) {
  const r = await api("POST", "/api/v1/artifacts", { type: "skill", version, files: [{ path: `${name}/SKILL.md`, content_base64: b64(skill(name, version)) }], ...extra }, user);
  assert.equal(r.status, 201, `${name}@${version}: ${JSON.stringify(r.data)}`);
}
async function move(name, to, user = "rita") {
  const r = await api("POST", `/api/v1/artifacts/skill/${name}/transitions`, { to, reason: "news delivery test" }, user);
  assert.equal(r.status, 200, `${name} → ${to}: ${JSON.stringify(r.data)}`);
}
async function post(user, body) {
  const r = await api("POST", "/api/v1/news/posts", { body: "Text.", ...body }, user);
  assert.equal(r.status, 201, `post ${body.title}: ${JSON.stringify(r.data)}`);
  return r.data;
}
const published = () => received.filter((e) => e.type === "news.published");
const publishedAbout = (pred) => published().filter((e) => pred(e.item));
const summaries = (username) => received.filter((e) => e.type === "news.summary" && e.username === username);
const summaryNotes = async (user) => (await api("GET", "/api/v1/me/notifications?limit=200", undefined, user)).data.items.filter((n) => n.kind === "news_summary");
const label = (i) => i.post?.title ?? `${i.kind}:${i.artifact?.name}`;

before(async () => {
  work = mkdtempSync(join(tmpdir(), "skillforge-news-delivery-"));
  dataDir = join(work, "data");
  pluginsDir = join(work, "plugins");
  mkdirSync(dataDir, { recursive: true });
  // Only the fixture of this test: tests/fixtures/plugins/ is shared with other tests.
  cpSync(join(ROOT, "tests", "fixtures", "plugins", "news-probe"), join(pluginsDir, "news-probe"), { recursive: true });
  sink = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((r) => sink.listen(0, "127.0.0.1", r));
  await boot();
  for (const [u, role] of [["alice", "contributor"], ["rita", "reviewer"], ["carol", "contributor"], ["mia", "contributor"], ["dave", "contributor"], ["zoe", "viewer"]]) {
    await createUser(srv.base, who.admin.cookie, { username: u, password: pw(u), role });
    who[u] = await login(srv.base, u, pw(u));
  }
  // payments: carol leads, mia is a member; search: dave leads. zoe is in no team.
  assert.equal((await api("POST", "/api/v1/teams", { name: "payments", lead: "carol" })).status, 201);
  assert.equal((await api("POST", "/api/v1/teams/payments/members", { username: "mia" }, "carol")).status, 201);
  assert.equal((await api("POST", "/api/v1/teams", { name: "search", lead: "dave" })).status, 201);
  const url = `http://127.0.0.1:${sink.address().port}/news`;
  const cfg = await api("PATCH", "/api/v1/admin/plugins/news-probe", { config: { url } });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.data));
});

after(async () => {
  if (srv?.up) await srv.stop();
  sink?.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("news.published: an automatic item and a post at once, a scheduled post once across a restart; a draft and a deleted post never", async () => {
  await publish("alice", "pdf", "1.0.0");
  await move("pdf", "active");
  const pdf = await until(() => publishedAbout((i) => i.kind === "new_artifact" && i.artifact?.name === "pdf")[0]);
  assert.ok(pdf, `no news.published about pdf: ${JSON.stringify(published())}`);
  assert.deepEqual(pdf.item.artifact, { type: "skill", name: "pdf", visibility: "org", team: null });
  assert.equal(typeof pdf.at, "string");
  assert.ok(typeof pdf.url === "string" && pdf.url.includes("pdf"), `the event links to the artifact: ${pdf.url}`);

  await publish("mia", "ledger", "1.0.0", { visibility: "team", owner_team: "payments" });
  await move("ledger", "active");
  const ledger = await until(() => publishedAbout((i) => i.artifact?.name === "ledger")[0]);
  assert.deepEqual(ledger?.item.artifact, { type: "skill", name: "ledger", visibility: "team", team: "payments" }, "a plugin can drop another team's news");

  await post("admin", { title: "Registry upgrade on Friday" });
  const now = await until(() => publishedAbout((i) => i.post?.title === "Registry upgrade on Friday")[0]);
  assert.equal(now?.item.kind, "post");
  assert.deepEqual(now?.item.post, { title: "Registry upgrade on Friday", team: null, important: false });

  const soon = new Date(Date.now() + 2000).toISOString();
  await post("admin", { title: "Scheduled notice", publish_at: soon });
  await post("carol", { title: "Payments draft", team: "payments", draft: true });
  const gone = await post("admin", { title: "Withdrawn notice", publish_at: soon });
  assert.equal((await api("DELETE", `/api/v1/news/posts/${gone.id}`)).status, 200);
  assert.equal(publishedAbout((i) => i.post?.title === "Scheduled notice").length, 0, "a scheduled post is not announced before its time");

  const scheduled = await until(() => publishedAbout((i) => i.post?.title === "Scheduled notice")[0]);
  assert.ok(scheduled, "the scheduled post was not announced when its time came");
  await restart();
  await sleep(2000);
  assert.equal(publishedAbout((i) => i.post?.title === "Scheduled notice").length, 1, "announced again after the restart");
  assert.equal(publishedAbout((i) => i.artifact?.name === "pdf").length, 1, "an automatic item announced again after the restart");
  assert.equal(publishedAbout((i) => i.post?.title === "Payments draft").length, 0, "a draft is announced");
  assert.equal(publishedAbout((i) => i.post?.title === "Withdrawn notice").length, 0, "a deleted post is announced");
});

test("the summary preference: weekly by default, off, daily or weekly; anything else is 400", async () => {
  assert.deepEqual((await api("GET", "/api/v1/me/news-summary", undefined, "carol")).data, { period: "weekly" });
  for (const [u, period] of [["mia", "daily"], ["dave", "daily"], ["alice", "daily"], ["zoe", "daily"], ["rita", "off"]]) {
    const r = await api("PUT", "/api/v1/me/news-summary", { period }, u);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data, { period });
  }
  assert.equal((await api("PUT", "/api/v1/me/news-summary", { period: "hourly" }, "mia")).status, 400);
  assert.equal((await rawApi(srv.base, "GET", "/api/v1/me/news-summary")).status, 401);
  // The period is the one control of the summary: it is not a notification kind to switch off a second time (UX audit
  // t-20261119-062358-613c, finding 2 — a checkbox stopped the web notification while the plugin event still went).
  const prefs = (await api("GET", "/api/v1/me/notification-prefs", undefined, "mia")).data;
  assert.ok(!("news_summary" in (prefs.prefs ?? prefs)), `news_summary is a notification kind: ${JSON.stringify(prefs)}`);
});

test("the summary: an empty period sends nothing; the news of the period by the reader's rights, without their own actions; once per period across a restart", async () => {
  // Every item so far is from today, after the last 09:00 boundary: yesterday's period is empty.
  await sleep(1500);
  assert.equal(received.filter((e) => e.type === "news.summary").length, 0, "an empty summary was sent");
  assert.equal((await summaryNotes("mia")).length, 0, "an empty summary notification");

  await publish("alice", "pdf", "1.1.0"); // alice's own action: news for others, not in her summary
  await until(() => publishedAbout((i) => i.kind === "new_version" && i.version === "1.1.0")[0]);
  // Move every item into the last daily period: an hour before the last 09:00 (server time).
  const boundary = new Date();
  boundary.setHours(9, 0, 0, 0);
  if (boundary > new Date()) boundary.setDate(boundary.getDate() - 1);
  const inPeriod = new Date(boundary.getTime() - 3600_000).toISOString();
  const db = new DatabaseSync(join(dataDir, "skillforge.db"));
  db.prepare("UPDATE news_items SET at = ?, publish_at = CASE WHEN publish_at IS NULL THEN NULL ELSE ? END").run(inPeriod, inPeriod);
  db.close();

  const mia = await until(() => summaries("mia")[0]);
  assert.ok(mia, "no summary for mia");
  assert.equal(mia.period.to, boundary.toISOString());
  assert.equal(mia.period.from, new Date(boundary.getTime() - 86400_000).toISOString());
  assert.ok("email" in mia, "the event names the reader's e-mail or null");
  const miaSees = mia.items.map(label);
  for (const l of ["new_artifact:pdf", "new_artifact:ledger", "new_version:pdf", "Registry upgrade on Friday", "Scheduled notice"]) assert.ok(miaSees.includes(l), `${l} not in mia's summary: ${miaSees}`);
  assert.ok(!miaSees.includes("Payments draft") && !miaSees.includes("Withdrawn notice"), `a draft or a deleted post in the summary: ${miaSees}`);

  const dave = await until(() => summaries("dave")[0]);
  const daveSees = dave.items.map(label);
  assert.ok(daveSees.includes("new_artifact:pdf"), `dave: ${daveSees}`);
  assert.ok(!daveSees.includes("new_artifact:ledger"), `another team's artifact in dave's summary: ${daveSees}`);

  const alice = await until(() => summaries("alice")[0]);
  assert.ok(!alice.items.some((i) => i.kind === "new_version" && i.version === "1.1.0"), "alice's own stable version in her summary");
  assert.ok(alice.items.map(label).includes("new_artifact:pdf"), "rita's move of alice's skill is news for alice");

  const notes = await summaryNotes("mia");
  assert.equal(notes.length, 1, JSON.stringify(notes));
  assert.ok(notes[0].url.includes("/news"), `the notification links to the feed: ${notes[0].url}`);
  assert.equal(summaries("rita").length, 0, "rita turned the summary off");

  await restart();
  await sleep(2000);
  assert.equal(summaries("mia").length, 1, "a second summary for the same period after the restart");
  assert.equal((await summaryNotes("mia")).length, 1);
});

test("GET /api/v1/news: since, unread=true and the reader's seen_at; a flag other than true is 400", async () => {
  assert.equal((await api("POST", "/api/v1/news/seen", {}, "alice")).status, 200);
  const mark = (await api("GET", "/api/v1/news", undefined, "alice")).data.seen_at;
  assert.equal(typeof mark, "string", "seen_at after a visit");
  await sleep(20);
  await publish("dave", "grep", "1.0.0");
  await move("grep", "active"); // rita's action, visible to alice
  await publish("alice", "pdf", "1.2.0"); // her own action
  const unread = await api("GET", "/api/v1/news?unread=true", undefined, "alice");
  assert.equal(unread.status, 200, JSON.stringify(unread.data));
  assert.deepEqual(unread.data.items.map(label), ["new_artifact:grep"]);
  assert.equal(unread.data.seen_at, mark);
  assert.equal((await api("GET", "/api/v1/news?unread=1", undefined, "alice")).status, 400);
  const since = await api("GET", `/api/v1/news?since=${encodeURIComponent(mark)}`, undefined, "dave");
  assert.deepEqual(since.data.items.map(label).sort(), ["new_artifact:grep", "new_version:pdf"]);
  assert.equal((await api("GET", "/api/v1/news?since=yesterday", undefined, "dave")).status, 400);
  assert.equal((await rawApi(srv.base, "GET", "/api/v1/news")).data.seen_at, null, "without signing in there is no mark");
});

async function atom(path, headers = {}) {
  const r = await fetch(`${srv.base}${path}`, { headers });
  return { status: r.status, type: r.headers.get("content-type") ?? "", text: await r.text() };
}
function assertAtom(text) {
  assert.match(text, /^<\?xml version="1\.0" encoding="utf-8"\?>/i);
  assert.match(text, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  for (const tag of ["id", "title", "updated"]) assert.match(text, new RegExp(`<feed[^]*?<${tag}>[^<]+</${tag}>`), `feed ${tag}`);
  const entries = text.match(/<entry>[^]*?<\/entry>/g) ?? [];
  assert.ok(entries.length > 0 && entries.length <= 50, `entries: ${entries.length}`);
  for (const e of entries) {
    for (const tag of ["id", "title", "updated"]) assert.match(e, new RegExp(`<${tag}[^>]*>[^<]+</${tag}>`), `entry ${tag}: ${e}`);
    assert.match(e, /<link [^>]*href="[^"]+"/, `entry link: ${e}`);
  }
  return entries;
}

test("Atom: valid Atom 1.0 by the reader's rights, the public part without a token; text is escaped", async () => {
  await post("admin", { title: "Ampersand & <script>alert(1)</script>" });
  const token = (await api("POST", "/api/v1/me/tokens", { name: "reader" }, "dave")).data.token;
  const dave = await atom("/api/v1/news.atom", { authorization: `Bearer ${token}` });
  assert.equal(dave.status, 200, dave.text);
  assert.match(dave.type, /^application\/atom\+xml/);
  const entries = assertAtom(dave.text);
  assert.ok(entries.some((e) => e.includes("pdf")), "pdf not in dave's feed");
  assert.ok(!dave.text.includes("ledger"), "another team's artifact in dave's Atom feed");
  assert.ok(!dave.text.includes("<script>"), "a post title is not escaped");
  assert.ok(dave.text.includes("&lt;script&gt;") && dave.text.includes("&amp;"), "the escaped title is missing");
  const anon = await atom("/api/v1/news.atom");
  assert.equal(anon.status, 200);
  assertAtom(anon.text);
  assert.ok(!anon.text.includes("ledger"), "a team's news without signing in");
});

test("Atom key: shown once, opens only the feed of its owner, replaced and revoked with 404, never in the request log; refused to an MCP token", async () => {
  const first = await api("POST", "/api/v1/me/news-atom-key", {}, "mia");
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const key = first.data.key;
  assert.match(key, /^sfa_[A-Za-z0-9]+_[A-Za-z0-9_-]{20,}$/);
  assert.ok(first.data.url.endsWith(`/api/v1/news/atom/${key}`), first.data.url);
  const state = await api("GET", "/api/v1/me/news-atom-key", undefined, "mia");
  assert.equal(state.status, 200);
  assert.ok(!JSON.stringify(state.data).includes(secretOf(key)), "the key is shown again");

  const feed = await atom(`/api/v1/news/atom/${key}`);
  assert.equal(feed.status, 200);
  assertAtom(feed.text);
  assert.ok(feed.text.includes("ledger"), "mia's feed lacks her team's artifact");
  for (const path of ["/api/v1/artifacts", "/api/v1/news", "/api/v1/me"]) {
    assert.equal((await fetch(`${srv.base}${path}`, { headers: { authorization: `Bearer ${key}` } })).status, 401, `the Atom key opens ${path}`);
  }

  const second = (await api("POST", "/api/v1/me/news-atom-key", {}, "mia")).data.key;
  assert.notEqual(second, key);
  assert.equal((await atom(`/api/v1/news/atom/${key}`)).status, 404, "the replaced key still works");
  assert.equal((await atom(`/api/v1/news/atom/${second}`)).status, 200);
  assert.ok([200, 204].includes((await api("DELETE", "/api/v1/me/news-atom-key", undefined, "mia")).status));
  assert.equal((await atom(`/api/v1/news/atom/${second}`)).status, 404, "the revoked key still works");
  assert.equal((await atom("/api/v1/news/atom/sfa_nope_xxxxxxxxxxxxxxxxxxxxxxxx")).status, 404);

  await sleep(300);
  const log = join(dataDir, "logs", "skillforge.log");
  assert.ok(existsSync(log), "no request log");
  const text = readFileSync(log, "utf8");
  for (const k of [key, second]) assert.ok(!text.includes(secretOf(k)), "an Atom key in the request log");

  const mcp = (await api("POST", "/api/v1/me/tokens", { name: "agent", mcp: true }, "mia")).data.token;
  const refused = await rawApi(srv.base, "POST", "/api/v1/me/news-atom-key", {}, { token: mcp });
  assert.equal(refused.status, 403);
  assert.equal(refused.data.error, "mcp_token_forbidden");
});

test("Atom without public read: 401 without a token", async () => {
  const closed = await startServer({ SKILLFORGE_PUBLIC_READ: "false" }, { prefix: "skillforge-news-atom-closed-" });
  assert.ok(closed.up, closed.stderr);
  try {
    assert.equal((await fetch(`${closed.base}/api/v1/news.atom`)).status, 401);
  } finally {
    await closed.stop();
  }
});
