// On a phone screen a wide table in the help page stretched the whole page (998 px in agent-support, 562 px in install at a width of 375): the table
// must scroll inside its own container, while the page stays as wide as the screen.
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 375, height: 800 } });

for (const topic of ["getting-started/agent-support", "getting-started/install"]) {
  test(`the table in topic ${topic} does not stretch the page on a phone`, async ({ page }) => {
    await page.goto(`/help/${topic}`);
    await expect(page.locator("table").first()).toBeVisible();
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth, "page width").toBeLessThanOrEqual(375);
    // The table still keeps its own width and scrolls inside its container.
    const scrolls = await page
      .locator("table")
      .first()
      .evaluate((t) => {
        const box = t.parentElement!;
        return box.scrollWidth > box.clientWidth && getComputedStyle(box).overflowX === "auto";
      });
    expect(scrolls, "the table scrolls inside its own container").toBe(true);
  });
}
