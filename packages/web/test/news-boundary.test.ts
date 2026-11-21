// «Earlier — already seen» stands after the last item newer than the reader's previous seen mark, by time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { seenBoundaryIndex } from "../src/lib/news-boundary.ts";

const at = (h: number) => `2026-11-20T${String(h).padStart(2, "0")}:00:00.000Z`;
const item = (actor: string, hour: number) => ({ actor, at: at(hour) });

test("the boundary stands after the last item newer than the previous mark", () => {
  const items = [item("rita", 5), item("rita", 4), item("rita", 1), item("rita", 0)];
  assert.equal(seenBoundaryIndex(items, at(2), "bob"), 1);
});

test("no previous mark: no boundary", () => {
  assert.equal(seenBoundaryIndex([item("rita", 5), item("rita", 1)], null, "bob"), null);
});

test("nothing newer than the mark: no boundary", () => {
  assert.equal(seenBoundaryIndex([item("rita", 1), item("rita", 0)], at(2), "bob"), null);
  assert.equal(seenBoundaryIndex([], at(2), "bob"), null);
});

test("the newest item is the last loaded one: no boundary", () => {
  assert.equal(seenBoundaryIndex([item("rita", 5), item("rita", 4)], at(2), "bob"), null);
});

test("only the reader's own actions are newer: no boundary", () => {
  assert.equal(
    seenBoundaryIndex([item("bob", 5), item("bob", 3), item("rita", 1)], at(2), "bob"),
    null,
  );
});

test("the reader's own action newer than the mark stays above the boundary", () => {
  const items = [item("rita", 5), item("bob", 3), item("rita", 1)];
  assert.equal(seenBoundaryIndex(items, at(2), "bob"), 1);
});

test("pinned posts are not in items: an unread pinned post does not move the boundary", () => {
  // The page passes the feed items without the pinned posts; the count of unread (2 with the pinned one) is unused.
  const items = [item("rita", 5), item("rita", 1), item("rita", 0)];
  assert.equal(seenBoundaryIndex(items, at(2), "bob"), 0);
});

test("instants are compared, not strings", () => {
  // The same instant in another form is not newer; a later instant with an offset is newer.
  const items = [
    { actor: "rita", at: "2026-11-20T04:00:00+02:00" },
    { actor: "rita", at: "2026-11-20T02:00:00.000Z" },
    { actor: "rita", at: at(1) },
  ];
  assert.equal(seenBoundaryIndex(items, "2026-11-20T02:00:00Z", "bob"), null);
  assert.equal(seenBoundaryIndex(items, "2026-11-20T01:30:00.000Z", "bob"), 1);
  // As strings "2026-11-20T04:00:00+02:00" > "2026-11-20T03:00:00.000Z", as instants 02:00Z is older.
  assert.equal(seenBoundaryIndex(items, "2026-11-20T03:00:00.000Z", "bob"), null);
});
