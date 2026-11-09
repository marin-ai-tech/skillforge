// Acceptance e2e: promoting a version through channels via the confirmation dialog: beta → stable,
// badges on the version and on the artifact card. Seed: pdf-tools (0.1.0, 0.2.0), rita (reviewer).
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("version channels", () => {
  test("reviewer promotes a version beta → stable through the confirmation dialog", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "rita");
    await page.goto("/artifacts/skill/pdf-tools?tab=versions");
    await expect(page.locator(tid("versions-list"))).toBeVisible();
    const entry = page.locator(`${tid("version-entry")}[data-version="0.1.0"]`);
    await expect(entry).toBeVisible();

    // Step 1: to beta (if not already promoted by a previous run).
    if (!(await entry.locator(tid("version-channel-0.1.0")).textContent())?.includes("beta")) {
      await entry.locator(tid("set-channel-0.1.0")).click();
      await page.locator(tid("confirm-dialog")).locator(tid("dialog-confirm")).click();
    }
    await expect(entry.locator(tid("version-channel-0.1.0"))).toContainText("beta");

    // Step 2: promote → stable.
    await entry.locator(tid("set-channel-0.1.0")).click();
    await page.locator(tid("confirm-dialog")).locator(tid("dialog-confirm")).click();
    await expect(entry.locator(tid("version-channel-0.1.0"))).toContainText("stable");
    await expect(page.locator(tid("artifact-latest-stable"))).toBeVisible();

    // A channel error (if the backend refuses) is rendered as a separate span — a UI contract.
    // Here we only check that there is no error after a successful promotion.
    await expect(page.locator(tid("set-channel-error-0.1.0"))).toHaveCount(0);
    await logout(page);
  });
});
