// Acceptance e2e tests for backups in the catalog UI.
// Creates and deletes backups in the e2e stand's data directory; does not touch users or artifacts.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const NAME_RE = /skillforge-\d{8}T\d{6}Z\.tar\.gz/;

test.describe("backups", () => {
  test("admin: create, download, restore hint, delete", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await page.goto("/admin/backups");
    await expect(page).toHaveTitle(/Backups · SkillForge/);
    await page.locator(tid("backup-create")).click();
    await expect(page.locator(tid("admin-notice"))).toContainText(NAME_RE);
    const row = page.locator(tid("backup-row")).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(NAME_RE);
    const name = (await row.textContent())?.match(NAME_RE)?.[0] ?? "";
    expect(name).not.toBe("");
    await expect(row.locator(tid("backup-download"))).toHaveAttribute("href", `/api/v1/admin/backups/${name}`);
    await expect(page.locator(tid("backups-restore-hint"))).toContainText(name);
    await expect(page.locator(tid("backups-restore-hint"))).toContainText("tar -xzf");
    const dl = await page.request.get(`/api/v1/admin/backups/${name}`);
    expect(dl.status()).toBe(200);
    expect(dl.headers()["content-type"]).toBe("application/gzip");
    await row.locator(tid("backup-delete")).click();
    await expect(page.locator(tid("dialog-confirm"))).toBeVisible();
    await page.locator(tid("dialog-confirm")).click();
    await expect(page.locator(tid("backup-row")).filter({ hasText: name })).toHaveCount(0);
    const gone = await page.request.get(`/api/v1/admin/backups/${name}`);
    expect(gone.status()).toBe(404);
    if ((await page.locator(tid("backup-row")).count()) === 0) {
      await expect(page.locator(tid("backups-empty"))).toBeVisible();
    }
    await logout(page);
  });

  test("menu: admin sees menu-backups and opens the page; viewer does not", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await page.reload();
    await page.locator(tid("nav-user")).click();
    const item = page.locator(tid("user-menu")).locator(tid("menu-backups"));
    await expect(item).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(/\/admin\/backups$/);
    await expect(page.locator(tid("backup-create"))).toBeVisible();
    await logout(page);
    await loginAs(page, "bob");
    await page.goto("/");
    await page.locator(tid("nav-user")).click();
    await expect(page.locator(tid("user-menu"))).toBeVisible();
    await expect(page.locator(tid("menu-backups"))).toHaveCount(0);
    await logout(page);
  });

  test("access: viewer sees admin-forbidden, anonymous is sent to login", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/admin/backups");
    await expect(page.locator(tid("admin-forbidden"))).toBeVisible();
    await expect(page.locator(tid("backup-create"))).toHaveCount(0);
    await logout(page);
    await page.goto("/admin/backups");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fbackups|\/login\?next=\/admin\/backups/);
  });
});
