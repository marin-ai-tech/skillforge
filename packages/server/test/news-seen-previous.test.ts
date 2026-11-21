// news-seen-boundary: `POST /api/v1/news/seen` returns the mark it replaced, `previous_seen_at`, so the News page can
// place «Earlier — already seen» by time. The first mark has no previous one (null); a mark that does not move returns
// the same value as previous and current; the mark never goes back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withApp, loginCookie } from "./helpers.ts";

type Seen = { seen_at: string | null; previous_seen_at: string | null; unread_count: number };

test("POST /news/seen returns the previous mark", async () => {
  await withApp(async (app) => {
    const cookie = await loginCookie(app);
    const seen = async (payload: object = {}) => {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/news/seen",
        headers: { cookie },
        payload,
      });
      assert.equal(r.statusCode, 200, r.body);
      return r.json() as Seen;
    };
    const post = async (title: string) => {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/news/posts",
        headers: { cookie },
        payload: { title, body: "Text." },
      });
      assert.equal(r.statusCode, 201, r.body);
    };

    await post("First");
    const first = await seen();
    assert.equal(first.previous_seen_at, null, "the first mark has no previous one");
    assert.equal(typeof first.seen_at, "string");

    await new Promise((r) => setTimeout(r, 10));
    await post("Second");
    const second = await seen();
    assert.equal(second.previous_seen_at, first.seen_at);
    assert.ok(second.seen_at! > first.seen_at!, "the mark moved to the newer post");

    const again = await seen();
    assert.equal(
      again.previous_seen_at,
      second.seen_at,
      "a mark that does not move: previous = current",
    );
    assert.equal(again.seen_at, second.seen_at);

    // negative: an older `at` does not move the mark back, and previous is still the mark in force
    const back = await seen({ at: "2000-01-01T00:00:00.000Z" });
    assert.equal(back.seen_at, second.seen_at);
    assert.equal(back.previous_seen_at, second.seen_at);

    const anon = await app.inject({ method: "POST", url: "/api/v1/news/seen", payload: {} });
    assert.equal(anon.statusCode, 401, "negative: no mark without sign-in");
  });
});
