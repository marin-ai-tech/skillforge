// Sign-in with a corporate account via the test LDAP (started by tests/e2e/global-setup.ts).
import { test, expect } from "@playwright/test";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("sign-in with a corporate account", () => {
  test("LDAP sign-in method: wrong password, then successful sign-in and sign-out", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator(tid("login-method-password"))).toBeVisible();
    const corp = page.locator(tid("login-method-corp"));
    await expect(corp).toContainText("Corporate account");
    await corp.click();
    await page.locator(tid("login-username")).fill("erin");
    await page.locator(tid("login-password")).fill("wrong-password");
    await page.locator(tid("login-submit")).click();
    await expect(page.locator(tid("login-error"))).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await page.locator(tid("login-password")).fill("erin-pw");
    await page.locator(tid("login-submit")).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
    const me = await page.request.get("/api/v1/me");
    expect(((await me.json()) as { user: { username: string } }).user.username).toBe("erin");
    await page.locator(tid("nav-user")).click();
    await page.locator(tid("nav-logout")).click();
    await expect(page.locator(tid("nav-login"))).toBeVisible();
  });
});
