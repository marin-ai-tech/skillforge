// Help structure follows best practices: a section tree instead of an endless list, a topic intro ("why" and "you will learn"),
// a single heading, a topic table of contents, "Back / Next", callouts with an icon and color; the same in the side panel.
import { test, expect } from "@playwright/test";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("help: structure", () => {
  test("section tree: at most 30 links, actions and codes are collapsed and expandable", async ({ page }) => {
    await page.goto("/help");
    const nav = page.locator(tid("help-nav"));
    await expect(nav).toBeVisible();
    const sections = nav.locator(tid("help-nav-section"));
    expect(await sections.count()).toBeGreaterThanOrEqual(8);
    await expect(nav.locator("a:visible")).not.toHaveCount(0);
    expect(await nav.locator("a:visible").count()).toBeLessThanOrEqual(30);
    for (const id of ["actions", "codes"]) {
      const s = nav.locator(`${tid("help-nav-section")}[data-section="${id}"]`);
      const toggle = s.locator("button").first();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toContainText(/\d+/);
    }
    const codes = nav.locator(`${tid("help-nav-section")}[data-section="codes"]`);
    await codes.locator("button").first().click();
    await expect(codes.locator("button").first()).toHaveAttribute("aria-expanded", "true");
    expect(await codes.locator("a:visible").count() + (await codes.locator("button:visible").count())).toBeGreaterThan(1);
  });

  test("current topic: its section is expanded, the link is highlighted, other sections are collapsed", async ({ page }) => {
    await page.goto("/help/codes/E_NAME_INVALID");
    const nav = page.locator(tid("help-nav"));
    const current = nav.locator('a[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toBeVisible();
    await expect(nav.locator(`${tid("help-nav-section")}[data-section="codes"] > button`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(nav.locator(`${tid("help-nav-section")}[data-section="start"] > button`)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("topic: one heading, intro, table of contents, Back / Next, no garbled characters", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/help/getting-started/lifecycle");
    const content = page.locator(tid("help-content"));
    await expect(content.locator("h1")).toHaveCount(1);
    await expect(content.locator("h1")).toHaveText("Lifecycle statuses");
    const intro = content.locator(tid("help-intro"));
    await expect(intro).toBeVisible();
    expect((await intro.innerText()).length).toBeGreaterThan(40);
    const learn = intro.locator(`${tid("help-learn")} li`);
    expect(await learn.count()).toBeGreaterThanOrEqual(2);
    expect(await learn.count()).toBeLessThanOrEqual(5);
    const toc = page.locator(tid("help-toc"));
    await expect(toc).toBeVisible();
    const links = toc.locator("a");
    expect(await links.count()).toBeGreaterThanOrEqual(3);
    const href = await links.nth(1).getAttribute("href");
    expect(href).toMatch(/^#/);
    await links.nth(1).click();
    await expect(page.locator(`[id="${href!.slice(1)}"]`)).toBeInViewport();
    await expect(page.locator(tid("help-prevnext"))).toBeVisible();
    expect(await content.innerText()).not.toMatch(/\w \? \w/);
  });

  test("when a long topic is scrolled, the section tree and the table of contents stay on screen", async ({ page }) => {
    // The table of contents block must not scroll away with the page.
    await page.setViewportSize({ width: 1400, height: 700 });
    await page.goto("/help/getting-started/lifecycle");
    await expect(page.locator(tid("help-toc"))).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator(tid("help-nav"))).toBeInViewport();
    await expect(page.locator(tid("help-toc"))).toBeInViewport();
    await expect(page.locator(`${tid("help-nav")} a[aria-current="page"]`)).toBeInViewport();
  });

  test("callout about irreversible actions: icon, label and its own color", async ({ page }) => {
    await page.goto("/help/getting-started/purge");
    const callout = page.locator(`${tid("help-callout")}[data-kind="caution"]`).first();
    await expect(callout).toBeVisible();
    await expect(callout.locator("svg").first()).toBeVisible();
    expect((await callout.innerText()).trim().length).toBeGreaterThan(10);
    const [box, body] = await Promise.all([
      callout.evaluate((e) => getComputedStyle(e).backgroundColor + "|" + getComputedStyle(e).borderLeftColor),
      page.locator("body").evaluate((e) => getComputedStyle(e).backgroundColor),
    ]);
    expect(box.split("|")[0]).not.toBe(body);
  });

  test("the side panel shows the same intro", async ({ page }) => {
    await page.goto("/");
    await page.locator(tid("help-button")).first().click();
    const panel = page.locator(tid("help-panel"));
    await expect(panel).toBeVisible();
    await expect(panel.locator(tid("help-intro"))).toBeVisible();
    await expect(panel.locator(`${tid("help-learn")} li`).first()).toBeVisible();
  });
});
