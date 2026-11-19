// E2E (news): the News page — pinned posts on top, the feed grouped by days, filters in the address, the empty state
// with a filter reset, an error with retry and the state before the answer; the header item says how many are unread
// and the count goes after the page is opened; the post form offers a lead only their own team and shows field errors;
// the What's new tile on the home page, whose error does not break the rest of the page. Data comes from the API of
// the shared server; failures and slow answers are made with page.route.
import { test, expect, type Page } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const NEWS_API = "**/api/v1/news?**";
const NEWS_API_BARE = "**/api/v1/news";
const b64 = (s: string) => Buffer.from(s).toString("base64");

async function routeNews(page: Page, handler: Parameters<Page["route"]>[1]) {
  await page.route(NEWS_API, handler);
  await page.route(NEWS_API_BARE, handler);
}

test.describe.serial("news", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/");
    await loginAs(page, "admin");
    // alice leads e2e-news (and teams of other specs on this shared server); rita leads e2e-news-other.
    for (const data of [
      { name: "e2e-news", lead: "alice" },
      { name: "e2e-news-other", lead: "rita" },
    ]) {
      expect([201, 409]).toContain((await page.request.post("/api/v1/teams", { data })).status());
    }
    for (const data of [
      { title: "E2E pinned notice", body: "Read **this** first.", pinned: true },
      { title: "E2E plain notice", body: "Unsafe [link](javascript:alert(1)) stays inert." },
    ]) {
      expect((await page.request.post("/api/v1/news/posts", { data })).status()).toBe(201);
    }
    await logout(page);
    await loginAs(page, "alice");
    const pub = await page.request.post("/api/v1/artifacts", {
      data: {
        type: "skill",
        files: [{ path: "e2e-news-skill/SKILL.md", content_base64: b64("---\nname: e2e-news-skill\ndescription: A skill for the news e2e. Use when news is tested.\n---\n\n# e2e-news-skill\n\nBody.\n") }],
      },
    });
    expect([201, 409]).toContain(pub.status());
    await logout(page);
    await loginAs(page, "rita");
    await page.request.post("/api/v1/artifacts/skill/e2e-news-skill/transitions", { data: { to: "active", reason: "news e2e" } });
    await logout(page);
    await page.close();
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("pinned on top, days as headings, items lead to the artifact; unsafe links do not run", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/news");
    await expect(page.locator(tid("news-pinned"))).toContainText("E2E pinned notice");
    await expect(page.getByRole("heading", { level: 2, name: /Today/ })).toBeVisible();
    const item = page.locator(tid("news-item")).filter({ hasText: "e2e-news-skill" }).first();
    await expect(item).toBeVisible();
    await expect(item.getByRole("link", { name: /e2e-news-skill/ })).toHaveAttribute("href", /\/artifacts\/skill\/e2e-news-skill/);
    const plain = page.locator(tid("news-item")).filter({ hasText: "E2E plain notice" });
    for (const href of await plain.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      expect(href.toLowerCase()).not.toContain("javascript:");
    }
  });

  test("the filter lives in the address; an empty result offers a reset", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await routeNews(page, (route) => route.fulfill({ json: { items: [], pinned: [], unread_count: 0, next_cursor: null } }));
    await page.goto("/news?kind=post");
    await expect(page.locator(tid("news-empty"))).toContainText("No news yet");
    await page.locator(tid("news-filter-reset")).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/news$/);
  });

  test("before the answer a loading state; an error offers retry", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    let calls = 0;
    await routeNews(page, async (route) => {
      calls++;
      if (calls === 1) {
        await held;
        return route.fulfill({ status: 500, json: { error: "internal_error" } });
      }
      return route.continue();
    });
    await page.goto("/news");
    await expect(page.locator(tid("news-loading"))).toBeVisible();
    release();
    await expect(page.locator(tid("news-error"))).toBeVisible();
    await page.locator(tid("news-retry")).click();
    await expect(page.locator(tid("news-item")).first()).toBeVisible();
  });

  test("the header item names the unread count; it goes after the page is opened", async ({ page }) => {
    // bob has already opened /news in the first test, so the count starts from a post made after that visit.
    await page.goto("/");
    await loginAs(page, "admin");
    const fresh = await page.request.post("/api/v1/news/posts", { data: { title: "E2E unread notice", body: "New since the last visit." } });
    expect(fresh.status()).toBe(201);
    await logout(page);
    await loginAs(page, "bob");
    await page.goto("/");
    const nav = page.locator(tid("nav-news"));
    await expect(nav).toHaveAccessibleName(/News, \d+ unread/);
    await nav.click();
    await expect(page).toHaveURL(/\/news/);
    await page.goto("/");
    await expect(page.locator(tid("nav-news"))).toHaveAccessibleName("News");
  });

  test("the post form offers a lead only their team and shows field errors; an admin gets everyone and teams", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/news");
    await page.locator(tid("news-new")).click();
    const audience = page.locator(tid("news-form-audience"));
    await expect(audience.locator("option", { hasText: "e2e-news" }).first()).toBeAttached();
    const leadOptions = await audience.locator("option").allTextContents();
    expect(leadOptions).toContain("e2e-news");
    expect(leadOptions, "a lead gets neither everyone nor a team they do not lead").not.toContain("Everyone");
    expect(leadOptions).not.toContain("e2e-news-other");
    await page.locator(tid("news-form-submit")).click();
    await expect(page.locator(tid("news-form-title-error"))).toBeVisible();
    await expect(page.locator(tid("news-form-title"))).toBeFocused();
    await logout(page);

    await loginAs(page, "bob");
    await page.goto("/news");
    await expect(page.locator(tid("news-new"))).toHaveCount(0);
    await logout(page);

    await loginAs(page, "admin");
    await page.goto("/news");
    await page.locator(tid("news-new")).click();
    const options = await page.locator(tid("news-form-audience")).locator("option").allTextContents();
    expect(options).toContain("Everyone");
    expect(options).toContain("e2e-news");
  });

  test("the What's new tile on the home page; its error does not break the page", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/");
    const tile = page.locator(tid("home-news"));
    await expect(tile).toContainText("E2E pinned notice");
    await expect(tile.getByRole("link", { name: "All news" })).toHaveAttribute("href", "/news");
    await routeNews(page, (route) => route.fulfill({ status: 500, json: { error: "internal_error" } }));
    await page.reload();
    await expect(tile.locator(tid("news-error"))).toBeVisible();
    await expect(page.locator(tid("home-recent"))).toBeVisible();
    await expect(page.locator('[data-testid^="home-count-"]').first()).toBeVisible();
  });
  test("an author returns to a draft and deletes it after a confirmation; others see no drafts and no edit buttons", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    const draft = await page.request.post("/api/v1/news/posts", {
      data: { title: "E2E draft notice", body: "Later.", team: "e2e-news", draft: true },
    });
    expect(draft.status()).toBe(201);
    await page.goto("/news");
    const drafts = page.locator(tid("news-drafts"));
    const row = drafts.locator(tid("news-item")).filter({ hasText: "E2E draft notice" });
    await expect(row).toBeVisible();
    await expect(row.locator(tid("news-post-edit"))).toBeVisible();
    await row.locator(tid("news-post-delete")).click();
    await expect(page.locator(tid("confirm-dialog"))).toBeVisible();
    await page.locator(tid("dialog-confirm")).click();
    await expect(page.locator(tid("news-item")).filter({ hasText: "E2E draft notice" })).toHaveCount(0);
    await logout(page);

    await loginAs(page, "bob");
    await page.goto("/news");
    await expect(page.locator(tid("news-item")).first()).toBeVisible();
    await expect(page.locator(tid("news-drafts"))).toHaveCount(0);
    await expect(page.locator(tid("news-post-edit"))).toHaveCount(0);
    await expect(page.locator(tid("news-post-delete"))).toHaveCount(0);
  });

  test("an admin must choose the audience; pinned posts step aside under a filter", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await page.goto("/news");
    await page.locator(tid("news-new")).click();
    await page.locator(tid("news-form-title")).fill("E2E audience check");
    await page.locator(tid("news-form-body")).fill("Who reads this?");
    await page.locator(tid("news-form-submit")).click();
    await expect(page.locator(tid("news-form-audience-error"))).toBeVisible();
    await page.goto("/news?kind=new_artifact");
    await expect(page.locator(tid("news-item")).first()).toBeVisible();
    await expect(page.locator(tid("news-pinned"))).toHaveCount(0);
  });
});
