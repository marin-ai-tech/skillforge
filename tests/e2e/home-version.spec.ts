// E2E: the home page footer shows the version. The version oracle is the public /api/v1/health.
import { test, expect } from "@playwright/test";

const tid = (id: string) => `[data-testid="${id}"]`;

test("home: the footer shows the SkillForge version, the same as in /api/v1/health", async ({ page, request }) => {
  const health = (await (await request.get("/api/v1/health")).json()) as { version: string };
  expect(health.version).toMatch(/^\d+\.\d+\.\d+/);

  await page.goto("/");
  const footer = page.locator(tid("home-version"));
  await expect(footer).toHaveText(`SkillForge ${health.version}`);

  // At the bottom: below the last mandatory block of the home page.
  await expect(page.locator(tid("home-review"))).toBeVisible();
  const review = await page.locator(tid("home-review")).boundingBox();
  const box = await footer.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(review!.y + review!.height);
});

test("home without /api/v1/health: the page works, with no footer and no error message", async ({ page }) => {
  await page.route("**/api/v1/health", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator(tid("home-review"))).toBeVisible();
  await expect(page.locator(tid("home-version"))).toHaveCount(0);
  await expect(page.locator(tid("error-state"))).toHaveCount(0);
});

test("the version is only on the home page: it is absent in the catalog", async ({ page }) => {
  await page.goto("/artifacts");
  await expect(page.locator(tid("browse-search")).first()).toBeVisible();
  await expect(page.locator(tid("home-version"))).toHaveCount(0);
});
