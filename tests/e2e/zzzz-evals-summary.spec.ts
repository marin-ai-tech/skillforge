// E2E (evals-summary): the metrics board shows reviewers an "Agents and models in evals" section. Without eval runs it
// explains where runtimes and task suites are set; with rows (the summary response is stubbed — the e2e server has no
// eval runtimes) it is a named table that scrolls inside its frame on a narrow screen. Others neither see the section
// nor ask for the summary.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const ROWS = {
  runs: 3,
  items: [
    { runner: "large", runner_label: "Large runner", agent: "claude-code", model: "claude-opus-5-5", artifacts: 2, tasks: 8, passed_with: 8, passed_without: 1, pass_rate_with: 1, pass_rate_without: 0.125, uplift: 0.875, cost_usd: 0.0336, cost_per_solve: 0.0042 },
    { runner: "small", runner_label: "Small runner", agent: "opencode", model: "qwen3-coder", artifacts: 1, tasks: 4, passed_with: 1, passed_without: 0, pass_rate_with: 0.25, pass_rate_without: 0, uplift: 0.25, cost_usd: null, cost_per_solve: null },
  ],
};

test("a reviewer without eval runs sees how to start them", async ({ page }) => {
  await page.goto("/");
  await loginAs(page, "rita");
  await page.goto("/metrics");
  const section = page.locator(tid("metrics-evals-summary"));
  await expect(section).toBeVisible();
  await expect(section).toContainText("SKILLFORGE_EVAL_RUNNERS_FILE");
  await expect(section.locator('a[href*="eval-runs-runners"]')).toHaveCount(1);
  await expect(section.locator("table")).toHaveCount(0);
  await logout(page);
});

test("a reviewer with eval runs sees a named table that fits a narrow screen", async ({ page }) => {
  await page.route("**/api/v1/evals/summary", (route) => route.fulfill({ json: ROWS }));
  await page.goto("/");
  await loginAs(page, "rita");
  await page.goto("/metrics");
  const table = page.getByRole("table", { name: "Agents and models in evals" });
  await expect(table).toBeVisible();
  const large = table.locator('[data-runner="large"]');
  await expect(large).toContainText("Large runner");
  await expect(large).toContainText("claude-opus-5-5");
  await expect(large).toContainText("100%");
  await expect(large).toContainText("$0.0042");
  await expect(table.locator('[data-runner="small"]')).toContainText("—");
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(table).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.unroute("**/api/v1/evals/summary");
  await logout(page);
});

test("a contributor and an anonymous visitor neither see the section nor ask for the summary", async ({ page }) => {
  let asked = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/evals/summary")) asked++;
  });
  await page.goto("/metrics");
  await expect(page.locator(tid("metrics-total-artifacts"))).toBeVisible();
  await expect(page.locator(tid("metrics-evals-summary"))).toHaveCount(0);
  await loginAs(page, "alice");
  await page.goto("/metrics");
  await expect(page.locator(tid("metrics-total-artifacts"))).toBeVisible();
  await expect(page.locator(tid("metrics-evals-summary"))).toHaveCount(0);
  expect(asked).toBe(0);
  await logout(page);
});
