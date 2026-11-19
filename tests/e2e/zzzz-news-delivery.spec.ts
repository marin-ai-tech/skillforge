// E2E (news-delivery): delivery settings in the cabinet (/me/notifications) — how often the news summary comes, and the
// personal Atom link: shown once after it is created, replaced and revoked only after a confirmation, the old link
// stops working. The News page points to the subscription.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe.serial("news delivery", () => {
  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("the summary period is weekly by default and keeps the reader's choice", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/me/notifications");
    const period = page.locator(tid("news-summary-period"));
    await expect(period).toHaveValue("weekly");
    await period.selectOption("daily");
    await expect(page.locator(tid("news-summary-status"))).toBeVisible();
    await page.reload();
    await expect(page.locator(tid("news-summary-period"))).toHaveValue("daily");
    await page.locator(tid("news-summary-period")).selectOption("weekly");
    await expect(page.locator(tid("news-summary-status"))).toBeVisible();
  });

  test("the Atom link is shown once; replacing and revoking ask first and stop the old link", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/me/notifications");
    await page.locator(tid("news-atom-issue")).click();
    const field = page.locator(tid("news-atom-url"));
    await expect(field).toHaveValue(/\/api\/v1\/news\/atom\/sfa_/);
    const first = await field.inputValue();
    await expect(page.locator(tid("news-atom-copy"))).toBeVisible();
    expect((await page.request.get(first)).status()).toBe(200);

    await page.reload();
    await expect(page.locator(tid("news-atom-url"))).toHaveCount(0);
    // the dialog takes focus on its safe choice and gives it back on Escape (UX audit, finding 1)
    await page.locator(tid("news-atom-issue")).click();
    await expect(page.locator(tid("confirm-dialog"))).toBeVisible();
    await expect(page.locator(tid("dialog-cancel"))).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(tid("confirm-dialog"))).toHaveCount(0);
    await expect(page.locator(tid("news-atom-issue"))).toBeFocused();
    await page.locator(tid("news-atom-issue")).click();
    await expect(page.locator(tid("confirm-dialog"))).toBeVisible();
    await page.locator(tid("dialog-confirm")).click();
    const second = await page.locator(tid("news-atom-url")).inputValue();
    expect(second).not.toBe(first);
    expect((await page.request.get(first)).status()).toBe(404);
    expect((await page.request.get(second)).status()).toBe(200);

    await page.locator(tid("news-atom-revoke")).click();
    await expect(page.locator(tid("confirm-dialog"))).toBeVisible();
    await page.locator(tid("dialog-confirm")).click();
    await expect(page.locator(tid("news-atom-revoke"))).toHaveCount(0);
    expect((await page.request.get(second)).status()).toBe(404);
  });

  test("the News page points to the subscription in a feed reader", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/news");
    await expect(page.locator(tid("news-subscribe"))).toHaveAttribute("href", /\/me\/notifications/);
  });
});
