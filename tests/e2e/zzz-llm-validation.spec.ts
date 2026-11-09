// Acceptance e2e: the "Skill checks" section on the administrator page. It shows what leaves the system; the decision is
// saved; without an address and a model there is no top-up button, because there is nothing to check with. The name `zzz-…` makes it run after specs that need a clean setup.
import { test, expect } from "@playwright/test";
import { loginAs } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test("skill checks: the warning is visible, disabling is persisted, the top-up button only appears when checking is active", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/admin/assistant");

  await expect(page.locator(tid("llm-validation-warning"))).toContainText("provider");
  const box = page.locator(tid("llm-validation-enabled"));

  await box.setChecked(false);
  await page.locator(tid("llm-save")).click();
  await expect(page.locator(tid("llm-notice"))).toBeVisible();
  await expect(page.locator(tid("llm-validation-backfill"))).toHaveCount(0);

  await page.reload();
  await expect(page.locator(tid("llm-validation-enabled"))).not.toBeChecked();
  await expect(page.locator(tid("llm-validation-usage"))).toBeVisible();
  await expect(page.locator(tid("llm-validation-daily-requests"))).toHaveValue(/^\d+$/);
});

test("a regular user does not see the settings page", async ({ page }) => {
  await loginAs(page, "alice");
  await page.goto("/admin/assistant");
  await expect(page.locator(tid("llm-validation"))).toHaveCount(0);
});
