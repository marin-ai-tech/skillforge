// Acceptance e2e. The home page showed the By type tiles with zeros until the type catalog had loaded, then placeholders, then the real numbers: a disabled counters query does not count as "loading". We check
// the state before the response (the response is held), not only the final result: a test of the final result failed only occasionally, when it hit the placeholder switch.
import { test, expect, type Page } from "@playwright/test";

const tid = (id: string) => `[data-testid="${id}"]`;
const TILES = '[data-testid^="home-count-"]';

async function totalSkills(page: Page): Promise<number> {
  const r = await page.request.get("/api/v1/artifacts?type=skill&limit=1&offset=0");
  expect(r.status()).toBe(200);
  return ((await r.json()) as { total: number }).total;
}

test("while the type catalog is not loaded there are no tiles with numbers; after loading the numbers are real", async ({ page }) => {
  const total = await totalSkills(page);
  expect(total).toBeGreaterThan(0);

  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/v1/artifact-types", async (route) => {
    await held;
    await route.continue();
  });

  await page.goto("/");
  await expect(page.locator(tid("home-review"))).toBeVisible();
  await expect(page.locator(TILES)).toHaveCount(0);

  release();
  await expect(page.locator(tid("home-count-skill"))).toContainText(String(total));
});

test("type catalog failed to load: tiles from the fallback list with real numbers, not permanent placeholders", async ({ page }) => {
  test.slow();
  const total = await totalSkills(page);
  await page.route("**/api/v1/artifact-types", (route) => route.abort());

  await page.goto("/");
  await expect(page.locator(tid("home-count-skill"))).toContainText(String(total), { timeout: 30_000 });
  await expect(page.locator(tid("home-count-settings"))).toBeVisible();
});
