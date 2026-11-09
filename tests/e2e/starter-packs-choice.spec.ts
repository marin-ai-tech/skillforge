// Acceptance e2e: the first-run page shows two optional
// starter packs as separate rows, each with its own button; installing ecc-essentials shows the result.
// Server is started by global-setup on E2E_PORT (see tests/e2e/state.ts), never the local stand port.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("first run: choice of starter packs", () => {
  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("both packs are listed separately; installing ecc-essentials installs its three skills", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/start");
    await expect(page.locator(tid("starter-pack-codealive"))).toBeVisible();
    await expect(page.locator(tid("starter-pack-ecc-essentials"))).toBeVisible();
    await page.locator(tid("install-starter-pack-ecc-essentials")).click();
    await expect(page.locator(tid("start-install-result"))).toBeVisible();
    const packs = await (await page.request.get("/api/v1/admin/starter-packs")).json();
    const ecc = packs.items.find((p: { id: string }) => p.id === "ecc-essentials");
    expect(ecc.installed).toBe(3);
  });
});
