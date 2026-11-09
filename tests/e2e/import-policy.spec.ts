// E2E: the policy panel is visible to and saved only by admin; an invalid rule is not saved.
import { test, expect } from "@playwright/test";
import { loginAs } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test("admin saves the policy, an invalid rule is rejected, the original value is restored", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/import");
  await page.locator(tid("import-policy")).locator("summary").click();
  await page.locator(tid("import-policy-rules")).fill("https://github.com/acme");
  await page.locator(tid("import-policy-save")).click();
  await expect(page.locator(tid("import-policy-message"))).toBeVisible();
  const bad = await page.request.get("/api/v1/admin/import-policy");
  expect((await bad.json()).policy.allowed_sources).toEqual([]);

  await page.locator(tid("import-policy-rules")).fill("GitHub.com/Acme");
  await page.locator(tid("import-policy-age")).fill("3");
  await page.locator(tid("import-policy-save")).click();
  await expect(page.locator(tid("import-policy-message"))).toBeVisible();
  const saved = (await (await page.request.get("/api/v1/admin/import-policy")).json()).policy;
  expect(saved.allowed_sources).toEqual(["github.com/acme"]);
  expect(saved.min_release_age_days).toBe(3);

  // The policy is shared by all specs: restore the defaults.
  const reset = await page.request.put("/api/v1/admin/import-policy", {
    data: { git_mode: "open", allowed_sources: [], allow_archives: true, min_release_age_days: 0 },
  });
  expect(reset.status()).toBe(200);
});

test("contributor does not see the panel", async ({ page }) => {
  await loginAs(page, "alice");
  await page.goto("/import");
  await expect(page.locator(tid("import-source"))).toBeVisible();
  await expect(page.locator(tid("import-policy"))).toHaveCount(0);
});
