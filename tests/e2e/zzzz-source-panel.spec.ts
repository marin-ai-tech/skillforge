// E2E (fix-source-panel-ux): the Source panel starts with a summary, shows the state as a badge with a
// tone and an icon (quarantine is not ok), keeps keyboard focus while a save is pending, and fits 320px. The source
// is stubbed with page.route on the seeded skill pdf-tools, so the spec needs no git source or network.
import { test, expect, type Page, type Route } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const SOURCE_URL = "**/api/v1/artifacts/skill/pdf-tools/source";

type Source = Record<string, unknown>;
const base = (over: Source = {}): Source => ({
  url: "https://github.com/acme/tools",
  path: "skills/pdf-tools",
  ref: null,
  last_commit: "a".repeat(40),
  last_checked_at: "2026-11-13T08:00:00.000Z",
  state: null,
  state_detail: null,
  enabled: true,
  edits: [],
  created_at: "2026-11-12T08:00:00.000Z",
  ...over,
});

async function serve(page: Page, source: () => Source, onPut?: (route: Route) => Promise<void>) {
  await page.route(SOURCE_URL, async (route) => {
    if (route.request().method() === "PUT" && onPut) return onPut(route);
    await route.fulfill({ json: { source: source() } });
  });
}

test.describe.serial("source panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
  });
  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("a summary line first; the state is a badge with a tone: quarantine differs from ok", async ({ page }) => {
    let current = base({ last_checked_at: null, last_commit: null });
    await serve(page, () => current);
    await page.goto("/artifacts/skill/pdf-tools");
    const summary = page.locator(tid("source-summary"));
    await expect(summary).toBeVisible();
    await expect(page.locator(tid("source-panel")).locator("> *").nth(1)).toHaveAttribute("data-testid", "source-summary");
    await expect(page.locator(tid("source-state-badge"))).toHaveCount(0);

    const cases: Array<[Source, string, string]> = [
      [{ state: "quarantined", state_detail: "2026-11-20T08:00:00.000Z" }, "warning", "⏳"],
      [{ state: "ok", state_detail: "0.1.1" }, "success", "✓"],
      [{ state: "unchanged" }, "neutral", ""],
      [{ state: "failed", state_detail: "github_unreachable" }, "danger", "⚠"],
    ];
    for (const [over, tone, icon] of cases) {
      current = base(over);
      await page.reload();
      const badge = page.locator(tid("source-state-badge"));
      await expect(badge).toHaveAttribute("data-tone", tone);
      if (icon) await expect(badge).toContainText(icon);
      await expect(summary).toContainText(await badge.innerText().then((t) => t.replace(icon, "").trim()));
    }
    // Negative: an up-to-date source is not shown as a problem.
    current = base({ state: "unchanged" });
    await page.reload();
    await expect(page.locator(tid("source-state-badge"))).not.toHaveAttribute("data-tone", "danger");
  });

  test("the tracking checkbox keeps focus while the save is pending", async ({ page }) => {
    let enabled = true;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await serve(
      page,
      () => base({ enabled }),
      async (route) => {
        await gate;
        enabled = JSON.parse(route.request().postData() ?? "{}").enabled ?? enabled;
        await route.fulfill({ json: { source: base({ enabled }) } });
      },
    );
    await page.goto("/artifacts/skill/pdf-tools");
    const box = page.locator(tid("source-enabled"));
    await box.focus();
    await page.keyboard.press("Space");
    await expect(box).toHaveAttribute("aria-disabled", "true");
    // Playwright counts aria-disabled as disabled; the native attribute is what drops keyboard focus.
    await expect(box).not.toHaveAttribute("disabled", /.*/);
    await expect(box).toBeFocused();
    release();
    await expect(box).not.toHaveAttribute("aria-disabled", "true");
    await expect(box).toBeFocused();
    await expect(box).not.toBeChecked();
  });

  test("320px: no horizontal scroll in the panel", async ({ page }) => {
    await serve(page, () =>
      base({
        state: "edits_outdated",
        state_detail: JSON.stringify({ op: "replace", file: "references/a-very-long-file-name-for-wrapping.md", find: "x".repeat(120), with: "" }),
        edits: [{ op: "delete", glob: "assets/**/a-very-long-glob-pattern-without-spaces-*.png" }],
      }),
    );
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/artifacts/skill/pdf-tools");
    const panel = page.locator(tid("source-panel"));
    await expect(panel).toBeVisible();
    const { scroll, client } = await panel.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(scroll).toBeLessThanOrEqual(client + 1);
  });
});
