// query-flags: a boolean query flag means the same on every route — `true` and `1` are yes, `false`, `0` and an empty
// value are no, anything else is 400 `bad_request` (not a silent "no": the web news client sent `drafts=1` and got no
// drafts). Every flag of every route is driven through the table, with its effect, not only its status; the clients
// (web, CLI) may send only the values the routes take.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db.ts";
import { withApp, loginCookie } from "./helpers.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ROUTES: Record<string, string[]> = {
  "/api/v1/news": ["unread", "mine", "drafts"],
  "/api/v1/me/notifications": ["unread"],
};
const YES = ["true", "1"];
const NO = ["false", "0", ""];
const BAD = ["yes", "TRUE", "2", "on"];

test("every flag of every route: true/1 yes, false/0/empty no, anything else 400", async () => {
  await withApp(async (app, dataDir) => {
    const cookie = await loginCookie(app);
    const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });
    for (const [route, flags] of Object.entries(ROUTES)) {
      for (const flag of flags) {
        for (const v of [...YES, ...NO]) {
          const r = await get(`${route}?${flag}=${v}`);
          assert.equal(r.statusCode, 200, `${route}?${flag}=${v}: ${r.body}`);
        }
        for (const v of BAD) {
          const r = await get(`${route}?${flag}=${v}`);
          assert.equal(r.statusCode, 400, `${route}?${flag}=${v} must be refused`);
          assert.equal((r.json() as { error: string }).error, "bad_request");
        }
      }
    }

    // Effect, not only status: a draft comes with drafts=1 as with drafts=true, and not without the flag.
    const draft = await app.inject({
      method: "POST",
      url: "/api/v1/news/posts",
      headers: { cookie },
      payload: { title: "Flags: draft", body: "Text.", draft: true },
    });
    assert.equal(draft.statusCode, 201, draft.body);
    const titles = async (q: string) =>
      (
        (await get(`/api/v1/news?${q}`)).json() as {
          items: Array<{ post: { title: string } | null }>;
        }
      ).items.map((i) => i.post?.title);
    assert.ok((await titles("drafts=1")).includes("Flags: draft"), "drafts=1");
    assert.ok((await titles("drafts=true")).includes("Flags: draft"), "drafts=true");
    assert.ok(!(await titles("drafts=0")).includes("Flags: draft"), "negative: drafts=0");

    // Notifications: unread=true filters as unread=1 does; unread=0 and no flag give all.
    const db = openDatabase(dataDir);
    try {
      const add = db.prepare(
        "INSERT INTO notifications (id, username, kind, title, url, created_at, read_at) VALUES (?, 'admin', 'plugin', ?, '/', ?, ?)",
      );
      add.run("n-flag-read", "read one", "2026-11-20T10:00:00.000Z", "2026-11-20T10:05:00.000Z");
      add.run("n-flag-new", "new one", "2026-11-20T11:00:00.000Z", null);
    } finally {
      db.close();
    }
    const ids = async (q: string) =>
      ((await get(`/api/v1/me/notifications${q}`)).json() as { items: Array<{ id: string }> }).items
        .map((n) => n.id)
        .filter((id) => id.startsWith("n-flag-"))
        .sort();
    assert.deepEqual(await ids("?unread=true"), ["n-flag-new"], "unread=true");
    assert.deepEqual(await ids("?unread=1"), ["n-flag-new"], "unread=1");
    assert.deepEqual(await ids("?unread=0"), ["n-flag-new", "n-flag-read"], "negative: unread=0");
    assert.deepEqual(await ids(""), ["n-flag-new", "n-flag-read"], "negative: no flag");
  });
});

test("the web and CLI clients send flag values the routes take", () => {
  const files = [
    path.join(ROOT, "packages", "web", "src", "api", "client.ts"),
    ...fs
      .readdirSync(path.join(ROOT, "packages", "cli", "src"), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(ROOT, "packages", "cli", "src", f)),
  ];
  const flags = new Set(Object.values(ROUTES).flat());
  const sent: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/\.set\(\s*"(\w+)",\s*"([^"]*)"\s*\)/g)) {
      if (!flags.has(m[1]!)) continue;
      sent.push(`${path.relative(ROOT, f)} ${m[1]}=${m[2]}`);
      assert.ok(YES.includes(m[2]!), `${path.relative(ROOT, f)} sends ${m[1]}=${m[2]}`);
    }
  }
  assert.ok(
    sent.length >= 5,
    `too few flag senders found — the pattern is stale: ${sent.join("; ")}`,
  );
});
