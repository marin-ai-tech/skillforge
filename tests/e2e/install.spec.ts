// Acceptance e2e tests for installation in the catalog UI.
// Seed: hook/destructive-guard is active, pdf-tools is candidate.
import { test, expect } from "@playwright/test";
import { BASE } from "./state.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("installation", () => {
  test("active hook: Claude Code commands, download links, counter", async ({ page }) => {
    await page.goto("/artifacts/hook/destructive-guard?tab=install");
    await expect(page.locator(tid("tab-install"))).toHaveAttribute("aria-selected", "true");
    const block = page.locator(tid("install-claude-code"));
    await expect(block).toBeVisible();
    await expect(page.locator(tid("install-marketplace-cmd"))).toContainText(`/plugin marketplace add ${BASE}/marketplace.json`);
    await expect(page.locator(tid("install-plugin-cmd"))).toContainText("/plugin install destructive-guard-hook@skillforge");
    const tgz = page.locator(tid("install-download-tgz"));
    await expect(tgz).toHaveAttribute("href", /\/api\/v1\/plugins\/hook\/destructive-guard\/[^/]+\.tar\.gz$/);
    await expect(page.locator(tid("install-download-zip"))).toHaveAttribute("href", /bundle\.zip$/);
    await expect(page.locator(tid("install-downloads"))).toBeVisible();
    const href = await tgz.getAttribute("href");
    const r = await page.request.get(href!);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toMatch(/application\/gzip/);
    await page.reload();
    await expect(page.locator(tid("install-downloads"))).toContainText(/[1-9]/);
  });

  test("candidate skill: an explanation instead of commands, download is available", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools?tab=install");
    await expect(page.locator(tid("install-not-active"))).toBeVisible();
    await expect(page.locator(tid("install-plugin-cmd"))).toHaveCount(0);
    await expect(page.locator(tid("install-download-tgz"))).toBeVisible();
  });

  test("home: marketplace connection block; marketplace.json serves only active", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(tid("home-install"))).toContainText(`/plugin marketplace add ${BASE}/marketplace.json`);
    const r = await page.request.get("/marketplace.json");
    expect(r.status()).toBe(200);
    const m = await r.json();
    expect(m.name).toBe("skillforge");
    expect(m.plugins.map((p: { name: string }) => p.name)).toContain("destructive-guard-hook");
    expect(m.plugins.map((p: { name: string }) => p.name)).not.toContain("pdf-tools");
    await page.goto("/artifacts/hook/destructive-guard");
    await expect(page.locator(tid("meta-downloads"))).toBeVisible();
  });
});
