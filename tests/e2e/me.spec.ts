// E2E: the `/me` page.
// Artifact statuses on the stand are changed by other specs
// (lifecycle.spec, sweep aging), so the page is compared with the `GET /api/v1/me/overview` response, not with constants.
import { test, expect, type Page } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const STATUSES = ["candidate", "active", "aging", "zombie", "retired"] as const;

type Overview = {
  user: { username: string; role: string };
  artifacts: { total: number; by_status: Record<string, number>; items: { type: string; name: string; status: string; latest_version: string | null }[] };
  agents: { total: number; items: { name: string }[] };
  tokens: { active: number; never_used: number };
  review: { pending: number; items: { type: string; name: string }[] } | null;
  activity: unknown[];
};

async function overview(page: Page): Promise<Overview> {
  const r = await page.request.get("/api/v1/me/overview");
  expect(r.status()).toBe(200);
  return (await r.json()) as Overview;
}

test.describe("user cabinet", () => {
  test("alice: menu → cabinet; artifacts, counters, tokens and the feed match the response; no review queue", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.reload();
    await page.locator(tid("nav-user")).click();
    const menu = page.locator(tid("user-menu"));
    await expect(menu).toBeVisible();
    await expect(menu.locator("a, button").first()).toHaveAttribute("data-testid", "menu-me");
    await menu.locator(tid("menu-me")).click();
    await expect(page).toHaveURL(/\/me$/);
    await expect(page).toHaveTitle("My workspace · SkillForge");

    const o = await overview(page);
    await expect(page.locator(tid("me-profile"))).toContainText("alice");
    await expect(page.locator(tid("me-role"))).toHaveText("contributor");

    expect(o.artifacts.total).toBeGreaterThan(0); // seed: agent/handoff-executor and hook/destructive-guard
    for (const s of STATUSES) {
      await expect(page.locator(tid(`me-artifacts-count-${s}`))).toContainText(String(o.artifacts.by_status[s]));
    }
    await expect(page.locator(tid("me-artifact"))).toHaveCount(o.artifacts.items.length);
    for (const a of o.artifacts.items) {
      const row = page.locator(`${tid("me-artifact")}[data-key="${a.type}/${a.name}"]`);
      await expect(row).toHaveCount(1);
      await expect(row.locator(tid("me-artifact-status"))).toHaveText(a.status);
      // The latest version in the row (per the spec).
      if (a.latest_version) await expect(row.locator(tid("me-artifact-version"))).toHaveText(`v${a.latest_version}`);
      await expect(row.locator(`a[href="/artifacts/${a.type}/${a.name}"]`)).toHaveCount(1);
    }

    if (o.agents.total === 0) {
      await expect(page.locator(tid("me-agents-empty"))).toContainText("skillforge agent scan");
    } else {
      await expect(page.locator(tid("me-agent"))).toHaveCount(o.agents.items.length);
    }
    await expect(page.locator(tid("me-tokens-active"))).toContainText(String(o.tokens.active));
    await expect(page.locator(tid("me-tokens-never-used"))).toContainText(String(o.tokens.never_used));
    await expect(page.locator(tid("me-tokens-manage"))).toHaveAttribute("href", "/me/tokens");

    await expect(page.locator(tid("me-review"))).toHaveCount(0);
    expect(o.activity.length).toBeGreaterThan(0);
    await expect(page.locator(tid("me-activity-item"))).toHaveCount(o.activity.length);
    await expect(page.locator(`${tid("me-activity-item")}[data-action="publish"]`).first()).toBeVisible();

    const help = page.locator(tid("help-button"));
    await expect(help).toHaveCount(1);
    await help.click();
    await expect(page.locator(tid("help-panel-title"))).toContainText("My workspace");
    await logout(page);
  });

  test("rita (reviewer): review queue with a count and a link to /lifecycle", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "rita");
    await page.goto("/me");
    const o = await overview(page);
    expect(o.review).not.toBeNull();
    const review = page.locator(tid("me-review"));
    await expect(review).toBeVisible();
    await expect(page.locator(tid("me-review-pending"))).toContainText(String(o.review!.pending));
    await expect(page.locator(tid("me-review-item"))).toHaveCount(o.review!.items.length);
    for (const a of o.review!.items) {
      await expect(page.locator(`${tid("me-review-item")}[data-key="${a.type}/${a.name}"]`)).toHaveCount(1);
    }
    await page.locator(tid("me-review-open")).click();
    await expect(page).toHaveURL(/\/lifecycle/);
    await logout(page);
  });

  test("bob (viewer): empty artifacts without a publish link, agents with a CLI command, no review queue", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/me");
    await expect(page.locator(tid("me-role"))).toHaveText("viewer");
    const empty = page.locator(tid("me-artifacts-empty"));
    await expect(empty).toBeVisible();
    await expect(empty.locator('a[href="/publish"]')).toHaveCount(0);
    await expect(page.locator(tid("me-agents-empty"))).toContainText("skillforge agent scan");
    await expect(page.locator(tid("me-review"))).toHaveCount(0);
    await logout(page);
  });

  test("an anonymous user on /me is sent to sign-in", async ({ page }) => {
    await page.goto("/me");
    await expect(page).toHaveURL(/\/login\?next=%2Fme$/);
  });
});
