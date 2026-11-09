// Acceptance e2e: login via a provider button through the test IdP (started by tests/e2e/global-setup.ts), login error,
// account source in the admin panel.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("login via a provider", () => {
  test("provider button on the login page: login via the test IdP and logout", async ({ page }) => {
    await page.goto("/login");
    const btn = page.locator(tid("login-sso-test-idp"));
    await expect(btn).toContainText("Test IdP");
    await btn.click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
    const me = await page.request.get("/api/v1/me");
    expect(me.status()).toBe(200);
    expect(((await me.json()) as { user: { username: string } }).user.username).toBe("dana");
    await page.locator(tid("nav-user")).click();
    await page.locator(tid("nav-logout")).click();
    await expect(page.locator(tid("nav-login"))).toBeVisible();
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
  });

  test("the login error is shown, the form and provider buttons are available", async ({ page }) => {
    await page.goto("/login?error=sso_invalid_token");
    await expect(page.locator(tid("login-error"))).toBeVisible();
    await expect(page.locator(tid("login-sso-test-idp"))).toBeVisible();
    await expect(page.locator(tid("login-submit"))).toBeVisible();
  });

  test("admin panel: a provider account has the source Test IdP and no password reset", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await page.goto("/admin/users");
    const dana = page.locator(`${tid("user-row")}[data-username="dana"]`);
    await expect(dana.locator(tid("user-source"))).toHaveText("Test IdP");
    await expect(dana.locator(tid("user-reset-password"))).toHaveCount(0);
    const adminRow = page.locator(`${tid("user-row")}[data-username="admin"]`);
    await expect(adminRow.locator(tid("user-source"))).toHaveText("Password");
    await logout(page);
  });
});
