// Evals tab: saving a suite with a case, the gate=required guard without holdout,
// run error without configured runners (the test stand has no SKILLFORGE_EVAL_RUNNERS_FILE).
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("Evals tab", () => {
  test("suite is saved; gate without holdout is blocked; a run without runners gives an error", async ({
    page,
  }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await page.goto("/artifacts/skill/pdf-tools?tab=evals");
    await expect(page.locator(tid("evals-panel"))).toBeVisible();
    await expect(page.locator(tid("eval-gate"))).toBeVisible();

    // Case + saving the suite.
    await page.getByRole("button", { name: "Add trigger case" }).click();
    const caseLi = page.locator('[data-testid^="eval-case-"]').first();
    await expect(caseLi).toBeVisible();
    await caseLi.locator('textarea[placeholder="prompt"]').fill("extract tables from pdf");
    await page.locator(tid("eval-save")).click();
    await expect(page.locator(tid("eval-suite-error"))).toHaveCount(0);
    await expect(page.locator('[data-testid^="eval-case-"]')).toHaveCount(1);

    // Guard: required without holdout cases is rejected before the request.
    await page.locator(tid("eval-gate")).selectOption("required");
    await expect(page.locator(tid("eval-suite-error"))).toContainText(/holdout/i);
    await page.locator(tid("eval-gate")).selectOption("off");

    // Starting a run without configured runners → a meaningful error in the UI.
    await page.locator(tid("eval-run-start")).click();
    await expect(page.locator(tid("eval-run-error"))).toContainText(/eval runners/i);
    await logout(page);
  });
});
