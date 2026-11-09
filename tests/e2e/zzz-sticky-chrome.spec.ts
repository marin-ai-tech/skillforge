// Acceptance e2e: on scroll the app header stays at the top of the window; in the catalog — the search and everything above it; in metrics —
// everything above the table; in help — the search, while the section tree and the table of contents stick below it and do not overlap.
import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

/** Scrolls to the bottom; fails when the page is too short to scroll (the check would prove nothing). */
async function scrollToEnd(page: Page) {
  const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(room, "the page must be scrollable").toBeGreaterThan(150);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(150);
}

const box = async (l: Locator) => (await l.boundingBox())!;

async function headerAtTop(page: Page) {
  const header = page.locator("header").first();
  await expect(header).toBeInViewport({ ratio: 1 });
  expect(Math.round((await box(header)).y)).toBe(0);
  return box(header);
}

/** `l` is fully on screen and below the app header. */
async function pinnedBelowHeader(page: Page, l: Locator) {
  const h = await headerAtTop(page);
  await expect(l).toBeInViewport({ ratio: 1 });
  expect((await box(l)).y).toBeGreaterThanOrEqual(h.y + h.height - 1);
}

test.describe("pinned header and panels", () => {
  test("catalog: header, search and filters stay on screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.goto("/artifacts");
    await expect(page.locator(`${tid("browse-results")} a`).first()).toBeVisible();
    await scrollToEnd(page);
    await expect(page.locator(tid("nav-search"))).toBeInViewport({ ratio: 1 });
    await pinnedBelowHeader(page, page.locator(tid("browse-search")));
    await pinnedBelowHeader(page, page.locator(tid("browse-status")));
  });

  test("narrow screen: the header stays at the top", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 640 });
    await page.goto("/artifacts");
    await expect(page.locator(`${tid("browse-results")} a`).first()).toBeVisible();
    await scrollToEnd(page);
    await headerAtTop(page);
  });

  test("metrics: everything above the table stays on screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 440 });
    await page.goto("/");
    await loginAs(page, "admin");
    await page.goto("/metrics");
    await expect(page.locator(tid("metrics-total-artifacts"))).toBeVisible();
    await scrollToEnd(page);
    await pinnedBelowHeader(page, page.locator(tid("metrics-total-artifacts")));
    await pinnedBelowHeader(page, page.locator(tid("metrics-filter-q")));
    await logout(page);
  });

  test("help: search is pinned, tree and table of contents below it, the anchor is not hidden", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 700 });
    await page.goto("/help/getting-started/lifecycle");
    await expect(page.locator(tid("help-toc"))).toBeVisible();
    await scrollToEnd(page);
    const search = page.locator(tid("help-search"));
    await pinnedBelowHeader(page, search);
    const s = await box(search);
    for (const id of ["help-nav", "help-toc"]) {
      const l = page.locator(tid(id));
      await expect(l).toBeInViewport();
      expect((await box(l)).y, `${id} below the search`).toBeGreaterThanOrEqual(s.y + s.height);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    const link = page.locator(`${tid("help-toc")} a`).nth(2);
    const href = (await link.getAttribute("href"))!;
    await link.click();
    const heading = page.locator(`[id="${href.slice(1)}"]`);
    await expect(heading).toBeInViewport();
    await expect
      .poll(async () => (await box(heading)).y - ((await box(search)).y + (await box(search)).height))
      .toBeGreaterThanOrEqual(0);
  });
});
