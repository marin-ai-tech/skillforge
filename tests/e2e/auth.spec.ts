// Acceptance e2e tests for authentication in the catalog UI.
// Users come from global-setup: admin / alice / bob.
import { test, expect } from "@playwright/test";
import { loginAs, logout, USERS } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("authentication", () => {
  test("anonymous: nav-login, /publish leads to /login?next=/publish", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(tid("nav-login"))).toBeVisible();
    await expect(page.locator(tid("nav-user"))).toHaveCount(0);
    await page.goto("/publish");
    await expect(page).toHaveURL(/\/login\?next=%2Fpublish|\/login\?next=\/publish/);
    await expect(page).toHaveTitle(/^Sign in · SkillForge/);
  });

  test("wrong password -> message, stay on /login", async ({ page }) => {
    await page.goto("/login");
    await page.locator(tid("login-username")).fill("admin");
    await page.locator(tid("login-password")).fill("definitely-wrong");
    await page.locator(tid("login-submit")).click();
    await expect(page.locator(tid("login-error"))).toContainText("Invalid username or password");
    await expect(page).toHaveURL(/\/login/);
  });

  test("form login returning to next, user indicator, logout", async ({ page }) => {
    await page.goto("/login?next=/publish");
    await page.locator(tid("login-username")).fill(USERS.admin.username);
    await page.locator(tid("login-password")).fill(USERS.admin.password);
    await page.locator(tid("login-submit")).click();
    await expect(page).toHaveURL(/\/publish$/);
    await expect(page.locator(tid("nav-user"))).toContainText("admin");
    await expect(page.locator(tid("publish-dropzone"))).toBeVisible();
    await page.locator(tid("nav-logout")).click();
    await expect(page.locator(tid("nav-login"))).toBeVisible();
    const me = await page.request.get("/api/v1/me");
    expect(me.status()).toBe(401);
  });

  test("viewer sees publish-forbidden instead of the form", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/publish");
    await expect(page.locator(tid("publish-forbidden"))).toBeVisible();
    await expect(page.locator(tid("publish-dropzone"))).toHaveCount(0);
    await expect(page.locator(tid("nav-user"))).toContainText("bob");
    await logout(page);
  });

  test("contributor publishes; published_by on the card is alice", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/artifacts/agent/handoff-executor");
    await expect(page.locator(tid("meta-published-by"))).toContainText("alice");
    await page.goto("/publish");
    await expect(page.locator(tid("publish-dropzone"))).toBeVisible();
    await logout(page);
  });

  test("expired session: a 401 from the API leads to /login with next", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/publish");
    await expect(page.locator(tid("publish-dropzone"))).toBeVisible();
    await page.context().clearCookies();
    await page.locator(tid("publish-mode-paste")).click();
    await page.locator(tid("publish-paste")).fill("---\nname: expired-session\ndescription: Session expired mid-form.\n---\n\nBody.\n");
    await expect(page).toHaveURL(/\/login\?next=/, { timeout: 5000 });
  });
});
