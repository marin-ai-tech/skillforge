// E2E (fix-session-ui): an anonymous tab does not poll /api/v1/me; while the session loads, the header shows neither
// "Sign in" nor the user menu.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test("an anonymous tab asks for the session once, not every second", async ({ page }) => {
  let calls = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && r.url().endsWith("/api/v1/me")) calls++;
  });
  await page.goto("/");
  await expect(page.locator(tid("nav-login"))).toBeVisible();
  await page.waitForTimeout(4000);
  expect(calls).toBeLessThanOrEqual(1);
});

test("a signed-in user does not see Sign in while the session loads", async ({ page }) => {
  await page.goto("/");
  await loginAs(page, "alice");
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/v1/me", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/artifacts");
  await page.waitForTimeout(500);
  await expect(page.locator(tid("nav-login"))).toHaveCount(0);
  release();
  await expect(page.locator(tid("nav-user"))).toBeVisible();
  await page.unroute("**/api/v1/me");
  await logout(page);
});
