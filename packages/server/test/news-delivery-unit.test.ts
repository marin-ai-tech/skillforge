// news-delivery (unit): announcing marks an item before its event and never repeats it; a draft and a future post
// wait; the summary period is the last passed 09:00 boundary; Atom text is escaped; the Atom key is masked in logs and
// a replaced key no longer resolves.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/db.ts";
import { announceDue, newsTickMs, summaryPeriod } from "../src/news/delivery.ts";
import { escapeXml, issueAtomKey, renderAtom, resolveAtomKey } from "../src/news/atom.ts";
import { withApp, loginCookie } from "./helpers.ts";
import { redactString } from "../src/logging.ts";
import {
  resetPluginEventHandlers,
  subscribePluginEvent,
  type PluginEvent,
} from "../src/plugins/events.ts";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-news-delivery-unit-"));
  const db = openDatabase(dir);
  migrate(db);
  return { db, dir };
}

function addPost(db: ReturnType<typeof openDatabase>, title: string, at: string, draft = 0): void {
  db.prepare(
    `INSERT INTO news_items (kind, at, actor, title, body, draft, publish_at, author, created_at, updated_at)
     VALUES ('post', ?, 'admin', ?, 'Body.', ?, ?, 'admin', ?, ?)`,
  ).run(at, title, draft, at, at, at);
}

test("announceDue: a due post once, marked before the event; a draft and a future post are not announced", async () => {
  const { db, dir } = freshDb();
  resetPluginEventHandlers();
  const got: PluginEvent[] = [];
  subscribePluginEvent("unit", "news.published", (e) => {
    got.push(e);
  });
  try {
    const now = new Date();
    addPost(db, "Due", new Date(now.getTime() - 1000).toISOString());
    addPost(db, "Later", new Date(now.getTime() + 3_600_000).toISOString());
    addPost(db, "Draft", new Date(now.getTime() - 1000).toISOString(), 1);
    assert.equal(announceDue(db, "http://x", now), 1);
    const marked = db
      .prepare("SELECT title FROM news_items WHERE announced_at IS NOT NULL")
      .all() as Array<{ title: string }>;
    assert.deepEqual(
      marked.map((r) => r.title),
      ["Due"],
    );
    assert.equal(announceDue(db, "http://x", now), 0, "announced twice");
    await new Promise((r) => setImmediate(r));
    assert.equal(got.length, 1);
    const evt = got[0]!;
    assert.equal(evt.type, "news.published");
    if (evt.type === "news.published") {
      assert.deepEqual(evt.item.post, { title: "Due", team: null, important: false });
      assert.equal(evt.item.artifact, null);
      assert.match(evt.url, /^http:\/\/x\/news#news-\d+$/);
    }
    assert.equal(
      announceDue(db, "http://x", new Date(now.getTime() + 7_200_000)),
      1,
      "the later post",
    );
  } finally {
    resetPluginEventHandlers();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("summaryPeriod: the last passed 09:00 and the day or the week (from Monday) before it", () => {
  const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h, 0, 0, 0);
  // Thursday 19 Nov 2026, 10:00 local: daily boundary today 09:00.
  const daily = summaryPeriod(at(2026, 11, 19, 10), "daily");
  assert.equal(daily.to.getTime(), at(2026, 11, 19, 9).getTime());
  assert.equal(daily.from.getTime(), daily.to.getTime() - 86_400_000);
  // 08:00: not yet — yesterday's 09:00.
  assert.equal(
    summaryPeriod(at(2026, 11, 19, 8), "daily").to.getTime(),
    at(2026, 11, 18, 9).getTime(),
  );
  // weekly: Monday 16 Nov 09:00; on Monday 23 Nov 08:00 still the 16th.
  assert.equal(
    summaryPeriod(at(2026, 11, 19, 10), "weekly").to.getTime(),
    at(2026, 11, 16, 9).getTime(),
  );
  assert.equal(
    summaryPeriod(at(2026, 11, 23, 8), "weekly").to.getTime(),
    at(2026, 11, 16, 9).getTime(),
  );
  assert.equal(
    summaryPeriod(at(2026, 11, 23, 9), "weekly").to.getTime(),
    at(2026, 11, 23, 9).getTime(),
  );
});

test("escapeXml, the tick period and the masked Atom key", () => {
  assert.equal(escapeXml(`a & <b> "c" 'd'`), "a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;");
  assert.equal(escapeXml("x\u0000y"), "xy");
  assert.equal(newsTickMs(undefined), 60_000);
  assert.equal(newsTickMs("500"), 500);
  assert.equal(newsTickMs("nope"), 60_000);
  const key = "sfa_AbCd1234_" + "s".repeat(43);
  const line = redactString(`GET /api/v1/news/atom/${key} 200`);
  assert.ok(!line.includes("s".repeat(43)), line);
  assert.ok(line.includes("/api/v1/news/atom/sfa_AbCd1234_***"), line);
});

test("the Atom key: stored as a hash, a new one replaces the old", () => {
  const { db, dir } = freshDb();
  try {
    const username = "unit-reader";
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES ('u-unit', ?, 'x', 'viewer', 'now', 'now')`,
    ).run(username);
    const first = issueAtomKey(db, username, new Date().toISOString());
    assert.match(first.key, /^sfa_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    const stored = db.prepare("SELECT key_hash FROM news_atom_keys").get() as { key_hash: string };
    assert.ok(!stored.key_hash.includes(first.key.split("_")[2]!), "the key is stored in clear");
    assert.equal(resolveAtomKey(db, first.key)?.username, username);
    const second = issueAtomKey(db, username, new Date().toISOString());
    assert.equal(resolveAtomKey(db, first.key), null, "the replaced key still resolves");
    assert.equal(resolveAtomKey(db, second.key)?.username, username);
    assert.equal(resolveAtomKey(db, "sfa_nope_xxxxxxxxxxxxxxxxxxxxxxxx"), null);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("announceDue inside an open transaction (a racing writer) marks nothing and reports busy", () => {
  const { db, dir } = freshDb();
  try {
    addPost(db, "Racing", new Date(Date.now() - 1000).toISOString());
    db.exec("BEGIN");
    assert.equal(announceDue(db, "http://x"), -1);
    db.exec("ROLLBACK");
    const row = db.prepare("SELECT announced_at FROM news_items").get() as {
      announced_at: string | null;
    };
    assert.equal(row.announced_at, null, "marked inside another transaction");
    assert.equal(announceDue(db, "http://x"), 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("renderAtom: Markdown and markup in a post stay text; one entry per item", () => {
  const xml = renderAtom(
    "http://x",
    [
      {
        id: "7",
        kind: "post",
        at: "2026-11-19T10:00:00.000Z",
        actor: "admin",
        artifact: null,
        version: null,
        from: null,
        to: null,
        replacement: null,
        post: {
          title: "A <b>bold</b> & ]]> title",
          body: "**md** <img src=x onerror=alert(1)>",
          team: null,
          pinned: false,
          important: false,
          publish_at: null,
          expires_at: null,
          draft: false,
          scheduled: false,
          author: "admin",
          can_edit: false,
        },
      },
    ],
    "2026-11-19T11:00:00.000Z",
  );
  assert.match(
    xml,
    /^<\?xml version="1\.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/,
  );
  assert.equal((xml.match(/<entry>/g) ?? []).length, 1);
  assert.ok(!xml.includes("<b>") && !xml.includes("<img") && !xml.includes("]]>"), xml);
  assert.ok(xml.includes("<updated>2026-11-19T10:00:00.000Z</updated>"), xml);
  assert.ok(xml.includes('href="http://x/news#news-7"'), xml);
});

test("routes: the Atom key is refused as a bearer, unknown and revoked answer the same 404, a token cannot mint a key; bad flags are 400", async () => {
  await withApp(async (app) => {
    const cookie = await loginCookie(app);
    const issued = await app.inject({
      method: "POST",
      url: "/api/v1/me/news-atom-key",
      headers: { cookie },
      payload: {},
    });
    assert.equal(issued.statusCode, 201, issued.body);
    const key = (issued.json() as { key: string }).key;
    const feed = await app.inject({ method: "GET", url: `/api/v1/news/atom/${key}` });
    assert.equal(feed.statusCode, 200, feed.body);
    assert.match(String(feed.headers["content-type"]), /^application\/atom\+xml; charset=utf-8/);
    for (const url of ["/api/v1/news.atom", "/api/v1/news", "/api/v1/me/news-summary"]) {
      const r = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${key}` },
      });
      assert.equal(r.statusCode, 401, `${url} opened by the Atom key`);
    }
    const del = await app.inject({
      method: "DELETE",
      url: "/api/v1/me/news-atom-key",
      headers: { cookie },
    });
    assert.equal(del.statusCode, 204);
    const revoked = await app.inject({ method: "GET", url: `/api/v1/news/atom/${key}` });
    const unknownKey = `sfa_${"Z".repeat(8)}_${"z".repeat(43)}`;
    const unknown = await app.inject({ method: "GET", url: `/api/v1/news/atom/${unknownKey}` });
    assert.equal(revoked.statusCode, 404);
    assert.equal(unknown.statusCode, 404);
    assert.equal(revoked.body, unknown.body, "revoked and unknown keys are told apart");
    const state = await app.inject({
      method: "GET",
      url: "/api/v1/me/news-atom-key",
      headers: { cookie },
    });
    assert.deepEqual(state.json(), { exists: false, prefix: null, created_at: null });

    const tok = await app.inject({
      method: "POST",
      url: "/api/v1/me/tokens",
      headers: { cookie },
      payload: { name: "personal" },
    });
    const token = (tok.json() as { token: string }).token;
    const minted = await app.inject({
      method: "POST",
      url: "/api/v1/me/news-atom-key",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    assert.equal(minted.statusCode, 403, "a personal token minted an Atom key");

    for (const q of ["unread=false", "unread=1", "since=2026-13-45T00:00:00Z", "since=soon"]) {
      const r = await app.inject({ method: "GET", url: `/api/v1/news?${q}`, headers: { cookie } });
      assert.equal(r.statusCode, 400, q);
    }
    const extra = await app.inject({
      method: "PUT",
      url: "/api/v1/me/news-summary",
      headers: { cookie },
      payload: { period: "daily", more: 1 },
    });
    assert.equal(extra.statusCode, 400);
  });
});
