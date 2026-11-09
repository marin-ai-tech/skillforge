// MVP e2e: first-run page /start for admin and reviewer.
// Server is started by global-setup on E2E_PORT (see tests/e2e/state.ts), never the local stand port.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("MVP first run /start", () => {
  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("admin sees checklist, starter packs and batch promote", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/start");
    await expect(page.locator(tid("start-checklist"))).toBeVisible();
    await expect(page.locator(tid("start-starter-packs"))).toBeVisible();
    await expect(page.locator(tid("start-batch-promote"))).toBeVisible();
    const packs = await page.request.get("/api/v1/admin/starter-packs");
    expect(packs.status()).toBe(200);
  });

  test("admin installs a starter pack from /start", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/start");
    const install = page.locator('[data-testid^="install-starter-pack-"]').first();
    if ((await install.count()) === 0) test.skip(true, "no starter packs configured");
    await install.click();
    await expect(page.locator(tid("start-install-result"))).toBeVisible();
  });

  test("reviewer sees checklist and batch promote (candidates_promoted step)", async ({ page }) => {
    await loginAs(page, "rita");
    await page.goto("/start");
    await expect(page.locator(tid("start-checklist"))).toBeVisible();
    await expect(page.locator(tid("start-batch-promote"))).toBeVisible();
  });

  test("viewer gets the forbidden message on /start", async ({ page }) => {
    await loginAs(page, "bob");
    await page.goto("/start");
    await expect(page.locator(tid("start-forbidden"))).toBeVisible();
  });
});