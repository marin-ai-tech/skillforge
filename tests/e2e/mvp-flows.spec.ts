// MVP e2e: P0 flows - roles, batch promote, teams (alpha),
// notifications (bell), /metrics, evals, purge, /lifecycle. Mirrors the manual test cases.
import { test, expect } from "@playwright/test";
import { USERS, loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("MVP flows", () => {
  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("every role can sign in and read /api/v1/me", async ({ page }) => {
    for (const who of Object.keys(USERS) as Array<keyof typeof USERS>) {
      await loginAs(page, who);
      const me = await page.request.get("/api/v1/me");
      expect(me.status()).toBe(200);
      await logout(page);
    }
  });

  test("reviewer batch promote: API validates body and requires reviewer", async ({ page }) => {
    await loginAs(page, "bob");
    const denied = await page.request.post("/api/v1/lifecycle/batch-transitions", { data: { items: [] } });
    expect([401, 403]).toContain(denied.status());
    await logout(page);
    await loginAs(page, "rita");
    const bad = await page.request.post("/api/v1/lifecycle/batch-transitions", { data: {} });
    expect(bad.status()).toBe(400);
  });

  test("teams: admin creates team alpha and opens it", async ({ page }) => {
    await loginAs(page, "admin");
    const created = await page.request.post("/api/v1/teams", {
      data: { name: "alpha", display_name: "Alpha", lead: "alice", description: "MVP e2e team alpha" },
    });
    expect([200, 201, 409]).toContain(created.status());
    const list = await page.request.get("/api/v1/teams");
    expect(list.status()).toBe(200);
    await page.goto("/teams");
    await expect(page.getByText(/alpha/i).first()).toBeVisible();
  });

  test("notifications: bell counter and notifications API", async ({ page }) => {
    await loginAs(page, "alice");
    const r = await page.request.get("/api/v1/me/notifications");
    expect(r.status()).toBe(200);
    await page.goto("/");
    await expect(page.locator(tid("notif-count")).or(page.getByRole("link", { name: /notification/i })).first()).toBeAttached();
  });

  test("metrics: /metrics page and overview API", async ({ page }) => {
    await loginAs(page, "admin");
    const r = await page.request.get("/api/v1/metrics/overview");
    expect(r.status()).toBe(200);
    await page.goto("/metrics");
    await expect(page.locator(tid("metrics-total-artifacts"))).toBeVisible();
  });

  test("evals: runs list for a seeded skill", async ({ page }) => {
    await loginAs(page, "rita");
    const r = await page.request.get("/api/v1/artifacts/skill/pdf-tools/evals/runs");
    expect(r.status()).toBeLessThan(500);
  });

  test("purge: forbidden for viewer, admin-only", async ({ page }) => {
    await loginAs(page, "bob");
    const r = await page.request.post("/api/v1/artifacts/skill/pdf-tools/purge", { data: { reason: "e2e" } });
    expect([401, 403, 404, 405]).toContain(r.status());
  });

  test("lifecycle: /lifecycle cleanup page for admin, forbidden for viewer", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/lifecycle");
    await expect(page.locator(tid("lifecycle-cleanup"))).toBeVisible();
    await logout(page);
    await loginAs(page, "bob");
    await page.goto("/lifecycle");
    await expect(page.locator(tid("lifecycle-forbidden"))).toBeVisible();
  });
});