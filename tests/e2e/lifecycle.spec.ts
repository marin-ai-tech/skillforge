// E2E: lifecycle governance in the catalog UI.
// Seed: hook/destructive-guard is active,
// the rest are candidate; users admin / alice (contributor) / bob (viewer) / rita (reviewer);
// SKILLFORGE_AGING_DAYS=0 — the sweep ages active artifacts immediately.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("lifecycle panel on the card", () => {
  test("contributor sees the status without buttons; so does viewer", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/artifacts/skill/linker");
    await expect(page.locator(tid("lifecycle-panel"))).toBeVisible();
    await expect(page.locator(tid("lifecycle-panel"))).toContainText("candidate");
    await expect(page.locator('[data-testid^="transition-"]')).toHaveCount(0);
    await logout(page);
  });

  test("reviewer: promote with a reason, audit, then retire requires a reason", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "rita");
    await page.goto("/artifacts/skill/linker");
    await page.locator(tid("transition-active")).click();
    const dialog = page.locator(tid("transition-dialog"));
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(tid("dialog-help"))).toBeVisible();
    await dialog.locator(tid("transition-reason")).fill("Reviewed the procedure");
    await dialog.locator(tid("transition-confirm")).click();
    await expect(page.locator(tid("detail-status"))).toContainText("active");
    await page.locator(tid("tab-audit")).click();
    const entry = page.locator(`${tid("audit-entry")}[data-action="transition"]`).first();
    await expect(entry).toContainText("candidate");
    await expect(entry).toContainText("active");
    await expect(entry).toContainText("Reviewed the procedure");

    await page.locator(tid("transition-retired")).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(tid("transition-confirm"))).toBeDisabled();
    await dialog.locator(tid("transition-reason")).fill("Superseded by pdf-tools");
    await expect(dialog.locator(tid("transition-confirm"))).toBeEnabled();
    await dialog.locator(tid("transition-confirm")).click();
    await expect(page.locator(tid("detail-status"))).toContainText("retired");
    await expect(page.locator(tid("transition-candidate"))).toBeVisible();
    await logout(page);
  });

  test("reviewer: version validation mark", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "rita");
    await page.goto("/artifacts/skill/pdf-tools?tab=versions");
    const entry = page.locator(`${tid("version-entry")}[data-version="0.2.0"]`);
    await entry.locator(tid("version-validate")).click();
    const dialog = page.locator(tid("validate-dialog"));
    await expect(dialog).toBeVisible();
    await dialog.locator(tid("validate-model-compat")).fill("opus-5, sonnet-5");
    await dialog.locator(tid("validate-note")).fill("Eval suite passed");
    await dialog.locator(tid("validate-confirm")).click();
    await expect(entry.locator(tid("version-validated-at"))).toBeVisible();
    await expect(entry).toContainText("opus-5");
    await expect(entry).toContainText("sonnet-5");
    await logout(page);
  });
});

test.describe("lifecycle page", () => {
  test("viewer → lifecycle-forbidden; anonymous → sign-in", async ({ page }) => {
    await page.goto("/lifecycle");
    await expect(page).toHaveURL(/\/login\?next=/);
    await loginAs(page, "bob");
    await page.goto("/lifecycle");
    await expect(page.locator(tid("lifecycle-forbidden"))).toBeVisible();
    await logout(page);
  });

  test("reviewer: review queue — promote from the queue", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "rita");
    await page.goto("/lifecycle?tab=review");
    await expect(page).toHaveTitle(/^Lifecycle · SkillForge/);
    await expect(page.locator(tid("tab-review"))).toHaveAttribute("aria-selected", "true");
    const card = page.locator(`${tid("artifact-card")}[data-name="propose"]`);
    await expect(card).toBeVisible();
    await card.locator(tid("queue-promote")).click();
    const dialog = page.locator(tid("transition-dialog"));
    await expect(dialog).toBeVisible();
    await dialog.locator(tid("transition-confirm")).click();
    await expect(card).toHaveCount(0);
    const r = await page.request.get("/api/v1/artifacts/command/propose");
    expect((await r.json()).artifact.status).toBe("active");
    await page.locator(tid("nav-user")).click();
    await expect(page.locator(tid("menu-lifecycle"))).toBeVisible();
    await logout(page);
  });

  test("retirement board after the sweep: aging → revalidate; retired → restore; block on the home page", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    const sweep = await page.request.post("/api/v1/admin/lifecycle/sweep");
    expect(sweep.status()).toBe(200);
    expect((await sweep.json()).aged).toBeGreaterThanOrEqual(1);
    await page.goto("/");
    await expect(page.locator(tid("home-delete-board"))).toBeVisible();
    await expect(page.locator(tid("home-delete-board"))).toContainText(/aging/i);
    await page.locator(`${tid("home-delete-board")} a`).first().click();
    await expect(page).toHaveURL(/\/lifecycle\?tab=delete/);
    const agingCard = page.locator(`${tid("board-aging")} ${tid("artifact-card")}[data-name="destructive-guard"]`);
    await expect(agingCard).toBeVisible();
    await expect(agingCard.locator(tid("board-retire"))).toBeVisible();
    await agingCard.locator(tid("board-revalidate")).click();
    await page.locator(`${tid("transition-dialog")} ${tid("transition-confirm")}`).click();
    await expect(agingCard).toHaveCount(0);
    const hook = await page.request.get("/api/v1/artifacts/hook/destructive-guard");
    expect((await hook.json()).artifact.status).toBe("active");

    await page.locator(tid("tab-retired")).click();
    const retiredCard = page.locator(`${tid("artifact-card")}[data-name="linker"]`);
    await expect(retiredCard).toBeVisible();
    await retiredCard.locator(tid("board-restore")).click();
    await page.locator(`${tid("transition-dialog")} ${tid("transition-confirm")}`).click();
    await expect(retiredCard).toHaveCount(0);
    const linker = await page.request.get("/api/v1/artifacts/skill/linker");
    expect((await linker.json()).artifact.status).toBe("candidate");
    await logout(page);
  });
});
