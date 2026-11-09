// E2E: the plugin platform in the catalog UI.
// The global-setup stand loads the plugin
// tests/fixtures/plugins/hello (SKILLFORGE_PLUGINS_DIR). Tests do not change the plugin's enabled state
// irreversibly: after disabling, hello is enabled back (the stand is not restarted).
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("plugins", () => {
  test("plugin navigation and its page are available to an anonymous user", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator(tid("nav-ext-hello-about"));
    await expect(nav).toBeVisible();
    await expect(nav).toHaveText("Hello");
    await nav.click();
    await expect(page).toHaveURL(/\/ext\/hello\/about$/);
    await expect(page).toHaveTitle(/About Hello · SkillForge/);
    await expect(page.locator(tid("ext-page-title"))).toHaveText("About Hello");
    const body = page.locator(tid("ext-page"));
    await expect(body).toContainText("served by the hello plugin");
    await expect(body.locator("strong")).toHaveText("hello");
    await expect(body.locator("script")).toHaveCount(0);
    await expect(body).not.toContainText("alert(1)");
    await page.goto("/ext/hello/nope");
    await expect(page.locator(tid("ext-page-missing"))).toBeVisible();
  });

  test("plugin tab on the artifact card", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools");
    const tab = page.locator(tid("tab-ext-hello-greeting"));
    await expect(tab).toBeVisible();
    await expect(tab).toHaveText("Greeting");
    await tab.click();
    const content = page.locator(tid("ext-tab-content"));
    await expect(content).toContainText("skill/pdf-tools");
    await expect(content.locator("strong")).toHaveText("skill/pdf-tools");
  });

  test("admin: list, status, disabling with a restart note, config", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await page.goto("/admin/plugins");
    await expect(page).toHaveTitle(/Plugins · SkillForge/);
    await expect(page.locator(tid("plugins-dir"))).toContainText("plugins");
    const row = page.locator(tid("plugin-row")).filter({ hasText: "hello" });
    await expect(row).toHaveCount(1);
    await expect(row.locator(tid("plugin-status"))).toHaveText("loaded");
    await expect(row).toContainText("1.0.0");
    await expect(page.locator(tid("plugin-restart-required"))).toHaveCount(0);
    await row.locator(tid("plugin-toggle")).click();
    await expect(row.locator(tid("plugin-restart-required"))).toBeVisible();
    await row.locator(tid("plugin-toggle")).click();
    const enabledAgain = await page.request.get("/api/v1/admin/plugins");
    const items = (await enabledAgain.json()).items as Array<{ name: string; enabled: boolean }>;
    expect(items.find((p) => p.name === "hello")?.enabled).toBe(true);

    const editor = row.locator(tid("plugin-config"));
    await editor.fill('{ "greeting": "Hi from e2e", "shout": false }');
    await row.locator(tid("plugin-config-save")).click();
    await expect(page.locator(tid("admin-notice"))).toBeVisible();
    const ping = await page.request.get("/api/v1/ext/hello/ping");
    expect((await ping.json()).greeting).toBe("Hi from e2e");
    await editor.fill('{ "greeting": 5 }');
    await row.locator(tid("plugin-config-save")).click();
    await expect(page.locator(tid("admin-error"))).toContainText("config_invalid");
    await editor.fill('{ "greeting": "Hello from config", "shout": false }');
    await row.locator(tid("plugin-config-save")).click();
    await expect(page.locator(tid("admin-notice"))).toBeVisible();
    await logout(page);
  });

  test("access: menu-plugins only for admin, viewer sees admin-forbidden, anonymous → sign-in", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await page.reload();
    await page.locator(tid("nav-user")).click();
    await expect(page.locator(tid("user-menu")).locator(tid("menu-plugins"))).toBeVisible();
    await logout(page);
    await loginAs(page, "bob");
    await page.goto("/admin/plugins");
    await expect(page.locator(tid("admin-forbidden"))).toBeVisible();
    await expect(page.locator(tid("plugins-table"))).toHaveCount(0);
    await page.goto("/");
    await page.locator(tid("nav-user")).click();
    await expect(page.locator(tid("menu-plugins"))).toHaveCount(0);
    await logout(page);
    await page.goto("/admin/plugins");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fplugins|\/login\?next=\/admin\/plugins/);
  });
});
