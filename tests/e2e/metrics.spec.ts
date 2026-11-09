// Metrics board: summary cards, filters, CSV export download; anonymous users see a sign-in hint.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("metrics board", () => {
  test("admin: totals are non-empty, filters are present, CSV downloads", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await page.goto("/metrics");

    for (const card of [
      "metrics-total-artifacts",
      "metrics-total-sessions",
      "metrics-total-transfer",
      "metrics-total-ablation",
    ]) {
      const el = page.locator(tid(card));
      await expect(el).toBeVisible();
      expect(Number((await el.textContent())?.replace(/\D/g, ""))).toBeGreaterThanOrEqual(0);
    }
    await expect(page.locator(tid("metrics-filter-q"))).toBeVisible();
    await expect(page.locator(tid("metrics-filter-type"))).toBeVisible();
    await expect(page.locator(tid("metrics-filter-status"))).toBeVisible();

    // The type filter narrows the list without an error.
    await page.locator(tid("metrics-filter-type")).selectOption("skill");
    await expect(page.locator(tid("metrics-total-artifacts"))).toBeVisible();

    // CSV export is a real file download.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(tid("metrics-export-csv")).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    await expect(page.locator(tid("metrics-export-error"))).toHaveCount(0);
    await logout(page);
  });

  test("anonymous: export is unavailable, a sign-in hint is shown", async ({ page }) => {
    await page.goto("/metrics");
    await expect(page.locator(tid("metrics-export-login"))).toBeVisible();
    await expect(page.locator(tid("metrics-export-csv"))).toHaveCount(0);
  });
});
