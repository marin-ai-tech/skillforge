// Acceptance e2e for the user menu and user administration. Runs last (alphabetical order);
// creates only the user dave, does not touch admin/alice/bob or artifacts. Token revocation and
// user disabling are confirmed with a dialog (dialog-confirm).
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("user menu", () => {
  test("anonymous: no nav-publish, nav-login is present", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(tid("nav-login"))).toBeVisible();
    await expect(page.locator(tid("nav-publish"))).toHaveCount(0);
  });

  test("admin: menu with tokens, password, admin panel and logout", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await page.reload();
    await expect(page.locator(tid("nav-publish"))).toBeVisible();
    await page.locator(tid("nav-user")).click();
    const menu = page.locator(tid("user-menu"));
    await expect(menu).toBeVisible();
    await expect(menu.locator(tid("menu-tokens"))).toBeVisible();
    await expect(menu.locator(tid("menu-password"))).toBeVisible();
    await expect(menu.locator(tid("menu-admin"))).toBeVisible();
    await expect(menu.locator(tid("nav-logout"))).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await logout(page);
  });

  test("contributor: menu without the admin panel; /admin/users → admin-forbidden", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.reload();
    await page.locator(tid("nav-user")).click();
    await expect(page.locator(tid("user-menu"))).toBeVisible();
    await expect(page.locator(tid("menu-admin"))).toHaveCount(0);
    await page.goto("/admin/users");
    await expect(page.locator(tid("admin-forbidden"))).toBeVisible();
    await expect(page.locator(tid("users-table"))).toHaveCount(0);
    await logout(page);
  });
});

test.describe("user administration", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
  });

  test("anonymous on /admin/users is sent to the login page", async ({ page }) => {
    await logout(page);
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fusers|\/login\?next=\/admin\/users/);
  });

  test("creating dave, changing the role, disabling and enabling, last_admin", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveTitle(/^Users · SkillForge/);
    await expect(page.locator(`${tid("user-row")}[data-username="admin"]`)).toBeVisible();

    await page.locator(tid("create-username")).fill("dave");
    await page.locator(tid("create-display-name")).fill("Dave");
    await page.locator(tid("create-password")).fill("dave-pw-123");
    await page.locator(tid("create-role")).selectOption("contributor");
    await page.locator(tid("create-submit")).click();
    const dave = page.locator(`${tid("user-row")}[data-username="dave"]`);
    await expect(dave).toBeVisible();
    await expect(dave).toContainText("contributor");
    const login = await page.request.post("/api/v1/auth/login", { data: { username: "dave", password: "dave-pw-123" } });
    expect(login.status()).toBe(200);
    await loginAs(page, "admin");

    await dave.locator(tid("user-role-select")).selectOption("reviewer");
    await expect(dave).toContainText("reviewer");
    await dave.locator(tid("user-disable-toggle")).click();
    await page.locator(tid("dialog-confirm")).click();
    await expect(dave).toContainText("Disabled");
    const disabled = await page.request.post("/api/v1/auth/login", { data: { username: "dave", password: "dave-pw-123" } });
    expect(disabled.status()).toBe(423);
    await dave.locator(tid("user-disable-toggle")).click();
    await expect(dave).toContainText("Active");

    await page.locator(tid("create-username")).fill("alice");
    await page.locator(tid("create-password")).fill("whatever-pw-1");
    await page.locator(tid("create-submit")).click();
    await expect(page.locator(tid("admin-error"))).toContainText("username_taken");

    const adminRow = page.locator(`${tid("user-row")}[data-username="admin"]`);
    await adminRow.locator(tid("user-role-select")).selectOption("viewer");
    await expect(page.locator(tid("admin-error"))).toContainText("last_admin");
    await expect(adminRow.locator(tid("user-role-select"))).toHaveValue("admin");
  });

  test("password reset from the admin panel", async ({ page }) => {
    await page.goto("/admin/users");
    const dave = page.locator(`${tid("user-row")}[data-username="dave"]`);
    await dave.locator(tid("user-reset-password")).click();
    await dave.locator(tid("user-new-password")).fill("dave-pw-456");
    await dave.locator(tid("user-reset-submit")).click();
    await expect(page.locator(tid("admin-notice"))).toBeVisible();
    const old = await page.request.post("/api/v1/auth/login", { data: { username: "dave", password: "dave-pw-123" } });
    expect(old.status()).toBe(401);
    const fresh = await page.request.post("/api/v1/auth/login", { data: { username: "dave", password: "dave-pw-456" } });
    expect(fresh.status()).toBe(200);
    await loginAs(page, "admin");
  });
});

test.describe("tokens and password", () => {
  test("alice: creating and revoking a token", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/me/tokens");
    await expect(page).toHaveTitle(/^API tokens · SkillForge/);
    await page.locator(tid("token-name")).fill("ci");
    await page.locator(tid("token-create-submit")).click();
    const secret = page.locator(tid("token-secret"));
    await expect(secret).toContainText(/sf_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}/);
    const token = (await secret.innerText()).match(/sf_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}/)![0];
    const row = page.locator(`${tid("token-row")}`).filter({ hasText: "ci" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Never");
    const me = await page.request.get("/api/v1/me", { headers: { authorization: `Bearer ${token}` } });
    expect(me.status()).toBe(200);
    await row.locator(tid("token-revoke")).click();
    await page.locator(tid("dialog-confirm")).click();
    await expect(row).toHaveCount(0);
    const revoked = await page.request.get("/api/v1/me", { headers: { authorization: `Bearer ${token}` } });
    expect(revoked.status()).toBe(401);
    await logout(page);
  });

  test("dave: changing the password — mismatch, wrong current one, success", async ({ page }) => {
    await page.goto("/");
    // The test prepares dave itself: it must not depend on the tests above that create dave and reset the password.
    await loginAs(page, "admin");
    const users = (await (await page.request.get("/api/v1/admin/users")).json()) as { items: Array<{ id: string; username: string }> };
    const daveId = users.items.find((u) => u.username === "dave")?.id;
    const ready = daveId
      ? await page.request.patch(`/api/v1/admin/users/${daveId}`, { data: { password: "dave-pw-456" } })
      : await page.request.post("/api/v1/admin/users", { data: { username: "dave", password: "dave-pw-456", role: "contributor" } });
    expect([200, 201]).toContain(ready.status());
    await logout(page);
    const login = await page.request.post("/api/v1/auth/login", { data: { username: "dave", password: "dave-pw-456" } });
    expect(login.status()).toBe(200);
    await page.goto("/me/password");
    await expect(page).toHaveTitle(/^Change password · SkillForge/);
    await page.locator(tid("password-current")).fill("dave-pw-456");
    await page.locator(tid("password-next")).fill("dave-pw-789");
    await page.locator(tid("password-confirm")).fill("dave-pw-000");
    await page.locator(tid("password-submit")).click();
    await expect(page.locator(tid("password-error"))).toContainText("Passwords do not match");

    await page.locator(tid("password-current")).fill("wrong-current");
    await page.locator(tid("password-confirm")).fill("dave-pw-789");
    await page.locator(tid("password-submit")).click();
    await expect(page.locator(tid("password-error"))).toContainText("Current password is incorrect");

    await page.locator(tid("password-current")).fill("dave-pw-456");
    await page.locator(tid("password-submit")).click();
    await expect(page.locator(tid("password-success"))).toBeVisible();
    const old = await page.request.post("/api/v1/auth/login", { data: { username: "dave", password: "dave-pw-456" } });
    expect(old.status()).toBe(401);
    const fresh = await page.request.post("/api/v1/auth/login", { data: { username: "dave", password: "dave-pw-789" } });
    expect(fresh.status()).toBe(200);
  });
});
