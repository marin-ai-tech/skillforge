// news-seen-boundary: «Earlier — already seen» on the News page stands right after the last item newer than the
// reader's previous seen mark, which `POST /api/v1/news/seen` returns as `previous_seen_at`. It is placed by time, not
// by counting `unread_count` down the list: an unread pinned post (not in the list) and the reader's own actions
// (not in the count) moved the counted boundary. «Only my artifacts» filters the feed (`mine=true`, `mine=1` in the
// address) and, like the other filters, hides the pinned posts and the boundary. Feed answers are made with page.route.
import { test, expect, type Page, type Route } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const DAY = "2026-11-20";
const at = (h: number) => `${DAY}T${String(h).padStart(2, "0")}:00:00.000Z`;

function item(id: string, actor: string, hour: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "status_change",
    at: at(hour),
    actor,
    artifact: { type: "skill", name: `boundary-${id}` },
    version: null,
    from: "candidate",
    to: "active",
    replacement: null,
    post: null,
    ...extra,
  };
}

function pinnedPost(id: string, hour: number) {
  return item(id, "rita", hour, {
    kind: "post",
    artifact: null,
    from: null,
    to: null,
    post: {
      title: `Pinned ${id}`,
      body: "Read first.",
      team: null,
      pinned: true,
      important: false,
      publish_at: null,
      expires_at: null,
      draft: false,
      scheduled: false,
      author: "rita",
      can_edit: false,
    },
  });
}

type Feed = { items: unknown[]; pinned: unknown[]; unread_count: number; previous: string | null };

/** The feed and the seen mark: every news read gets `feed`, the seen POST answers with `previous`. */
async function mockFeed(page: Page, feed: Feed, requests: string[] = []) {
  const answer = (route: Route) => {
    requests.push(route.request().url());
    return route.fulfill({
      json: {
        items: feed.items,
        pinned: feed.pinned,
        unread_count: feed.unread_count,
        next_cursor: null,
        seen_at: feed.previous,
      },
    });
  };
  await page.route("**/api/v1/news?**", answer);
  await page.route("**/api/v1/news", answer);
  await page.route("**/api/v1/news/seen", (route) =>
    route.fulfill({ json: { seen_at: at(23), previous_seen_at: feed.previous, unread_count: 0 } }),
  );
}

/** The id of the row right before the boundary, or null when there is no boundary. */
async function rowBeforeBoundary(page: Page): Promise<string | null> {
  const boundary = page.locator(tid("news-seen-boundary"));
  if ((await boundary.count()) === 0) return null;
  return boundary.evaluate((el) => el.previousElementSibling?.id ?? "");
}

test.describe("news seen boundary", () => {
  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("an unread pinned post does not push the boundary down", async ({ page }) => {
    // Mark at 02:00. New: pinned P (06:00, not in the list) and A (05:00). Seen: D, E. unread_count = 2.
    await mockFeed(page, {
      pinned: [pinnedPost("p", 6)],
      items: [item("a", "rita", 5), item("d", "rita", 1), item("e", "rita", 0)],
      unread_count: 2,
      previous: at(2),
    });
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/news");
    await expect(page.locator(tid("news-seen-boundary"))).toBeVisible();
    expect(await rowBeforeBoundary(page)).toBe("news-a");
  });

  test("the reader's own action newer than the mark stays above the boundary", async ({ page }) => {
    // Mark at 02:00. A (rita, 05:00) and B (bob's own, 03:00) are newer; D is older. unread_count = 1 (own not counted).
    await mockFeed(page, {
      pinned: [],
      items: [item("a", "rita", 5), item("b", "bob", 3), item("d", "rita", 1)],
      unread_count: 1,
      previous: at(2),
    });
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/news");
    await expect(page.locator(tid("news-seen-boundary"))).toBeVisible();
    expect(await rowBeforeBoundary(page)).toBe("news-b");
  });

  test("negative: no boundary without a previous mark, or when nothing older is loaded, or only own actions are new", async ({ page }) => {
    const feeds: Feed[] = [
      { pinned: [], items: [item("a", "rita", 5), item("d", "rita", 1)], unread_count: 2, previous: null },
      { pinned: [], items: [item("a", "rita", 5), item("c", "rita", 4)], unread_count: 2, previous: at(2) },
      { pinned: [], items: [item("b", "bob", 5), item("d", "rita", 1)], unread_count: 0, previous: at(2) },
    ];
    await page.goto("/");
    await loginAs(page, "bob");
    for (const feed of feeds) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockFeed(page, feed);
      await page.goto("/news");
      await expect(page.locator(tid("news-item")).first()).toBeVisible();
      await expect(page.locator(tid("news-seen-boundary"))).toHaveCount(0);
    }
  });

  test("«Only my artifacts» filters the feed, lives in the address, hides pinned posts and the boundary", async ({ page }) => {
    const requests: string[] = [];
    await mockFeed(
      page,
      {
        pinned: [pinnedPost("p", 6)],
        items: [item("a", "rita", 5), item("d", "rita", 1)],
        unread_count: 2,
        previous: at(2),
      },
      requests,
    );
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/news");
    await expect(page.locator(tid("news-seen-boundary"))).toBeVisible();
    const mine = page.locator(tid("news-filter-mine"));
    await expect(mine).not.toBeChecked();
    await mine.check();
    await expect(page).toHaveURL(/[?&]mine=1\b/);
    await expect.poll(() => requests.some((u) => /[?&]mine=true\b/.test(u))).toBe(true);
    await expect(page.locator(tid("news-pinned"))).toHaveCount(0);
    await expect(page.locator(tid("news-seen-boundary"))).toHaveCount(0);
    // Back from the address: the filter is on after a reload, off after unchecking.
    await page.reload();
    await expect(page.locator(tid("news-filter-mine"))).toBeChecked();
    await page.locator(tid("news-filter-mine")).uncheck();
    await expect(page).not.toHaveURL(/mine=/);
  });

  test("negative: a signed-out reader has no «Only my artifacts»", async ({ page }) => {
    await mockFeed(page, { pinned: [], items: [item("a", "rita", 5)], unread_count: 0, previous: null });
    await page.goto("/news");
    await expect(page.locator(tid("news-item")).first()).toBeVisible();
    await expect(page.locator(tid("news-filter-mine"))).toHaveCount(0);
  });
});
