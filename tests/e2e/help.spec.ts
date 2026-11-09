// Acceptance e2e tests for the help module (help panel, tips, help center).
// Users come from global-setup: admin / alice / bob.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

const PAGES: Array<{ path: string; title: RegExp; who?: "admin" | "alice" }> = [
  { path: "/", title: /Home/ },
  { path: "/artifacts", title: /Catalog/ },
  { path: "/artifacts/skill/pdf-tools", title: /Artifact/ },
  { path: "/login", title: /Sign in/ },
  { path: "/help", title: /Help/ },
  { path: "/publish", title: /Publish/, who: "alice" },
  { path: "/me/tokens", title: /tokens/i, who: "alice" },
  { path: "/me/password", title: /password/i, who: "alice" },
  { path: "/admin/users", title: /Users/, who: "admin" },
];

test.describe("page help", () => {
  for (const p of PAGES) {
    test(`help-button on ${p.path} opens the panel with the page topic`, async ({ page }) => {
      await page.goto("/");
      if (p.who) await loginAs(page, p.who);
      await page.goto(p.path);
      const buttons = page.locator(tid("help-button"));
      await expect(buttons).toHaveCount(1);
      await buttons.click();
      const panel = page.locator(tid("help-panel"));
      await expect(panel).toBeVisible();
      await expect(page.locator(tid("help-panel-title"))).toContainText(p.title);
      await expect(page).toHaveURL(new RegExp(p.path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "(\\?|$)"));
      await page.locator(tid("help-close")).click();
      await expect(panel).toBeHidden();
      if (p.who) await logout(page);
    });
  }

  test("the ? key opens and closes the panel; Escape closes it", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Shift+/");
    const panel = page.locator(tid("help-panel"));
    await expect(panel).toBeVisible();
    await expect(page.locator(tid("help-panel-title"))).toContainText(/Artifact/);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await page.keyboard.press("Shift+/");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Shift+/");
    await expect(panel).toBeHidden();
  });

  test("? in an input field does not open the panel", async ({ page }) => {
    await page.goto("/artifacts");
    await page.locator(tid("browse-search")).focus();
    await page.keyboard.type("?");
    await expect(page.locator(tid("help-panel"))).toBeHidden();
    await expect(page.locator(tid("browse-search"))).toHaveValue("?");
  });

  test("related topics and navigation to the help center", async ({ page }) => {
    await page.goto("/artifacts");
    await page.locator(tid("help-button")).click();
    const related = page.locator(`${tid("help-related")} a`);
    await expect(related.first()).toBeVisible();
    await related.first().click();
    await expect(page.locator(tid("help-panel"))).toBeVisible();
    await page.locator(tid("help-open-center")).click();
    await expect(page).toHaveURL(/\/help\//);
    await expect(page).toHaveTitle(/^Help · SkillForge/);
  });
});

test.describe("action tips", () => {
  test("hover on publish-submit shows help-tip with a Learn more link", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/publish");
    const btn = page.locator(tid("publish-submit"));
    await expect(btn).toHaveAttribute("title", /.+/);
    await expect(btn).toHaveAttribute("aria-describedby", /.+/);
    await btn.hover({ force: true });
    const tip = page.locator(tid("help-tip"));
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(/publish/i);
    await expect(tip.locator(tid("help-tip-more"))).toBeVisible();
    await tip.locator(tid("help-tip-more")).click();
    await expect(page.locator(tid("help-panel"))).toBeVisible();
    await logout(page);
  });

  test("keyboard focus shows the tip on browse-search", async ({ page }) => {
    await page.goto("/artifacts");
    await page.locator(tid("browse-search")).focus();
    const tip = page.locator(tid("help-tip"));
    await expect(tip).toBeVisible();
    await expect(page.locator(tid("browse-search"))).toHaveAttribute("title", /.+/);
  });

  test("all actions on the card and in navigation have a title", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools?tab=files");
    for (const id of ["nav-search", "theme-toggle", "nav-login", "version-select", "tab-overview", "tab-files", "tab-versions", "tab-audit", "meta-digest", "help-button"]) {
      const el = page.locator(tid(id)).first();
      await expect(el, id).toHaveAttribute("title", /.+/);
    }
    await expect(page.locator(tid("file-entry")).first()).toHaveAttribute("title", /.+/);
    await expect(page.locator(tid("file-dir")).first()).toHaveAttribute("title", /.+/);
  });

  test("a validation code in the publish result leads to the glossary", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/publish");
    await page.locator(tid("publish-mode-paste")).click();
    await page.locator(tid("publish-paste-filename")).fill("SKILL.md");
    await page.locator(tid("publish-paste")).fill("---\nname: Bad Name\ndescription: Broken.\n---\n\nBody.\n");
    const issue = page.locator(`${tid("publish-issue")}[data-code="E_NAME_INVALID"]`);
    await expect(issue).toBeVisible();
    await issue.locator(tid("issue-help")).click();
    await expect(page.locator(tid("help-panel-title"))).toContainText("E_NAME_INVALID");
    await expect(page.locator(tid("help-panel"))).toContainText(/How to fix/);
    await logout(page);
  });

  test("the confirmation dialog contains dialog-help (token revocation)", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/me/tokens");
    await page.locator(tid("token-name")).fill("help-e2e");
    await page.locator(tid("token-create-submit")).click();
    await expect(page.locator(tid("token-secret"))).toBeVisible();
    const row = page.locator(tid("token-row")).filter({ hasText: "help-e2e" });
    await row.locator(tid("token-revoke")).click();
    await expect(page.locator(tid("dialog-help"))).toBeVisible();
    await page.locator(tid("dialog-confirm")).click();
    await expect(row).toHaveCount(0);
    await logout(page);
  });
});

test.describe("help center", () => {
  test("navigation, code deep link, search", async ({ page }) => {
    await page.goto("/help");
    await expect(page).toHaveTitle(/^Help · SkillForge/);
    await expect(page.locator(tid("help-nav"))).toBeVisible();
    await expect(page.locator(tid("help-content"))).toContainText(/SkillForge/);
    await page.goto("/help/codes/E_NAME_INVALID");
    await expect(page.locator(tid("help-content"))).toContainText("E_NAME_INVALID");
    await expect(page.locator(tid("help-content"))).toContainText(/How to fix/);
    await page.locator(tid("help-search")).fill("digest");
    const results = page.locator(`${tid("help-results")} a`);
    await expect(results.filter({ hasText: /digest/i }).first()).toBeVisible();
    await page.goto("/help/nope/nothing");
    await expect(page.locator(tid("help-not-found"))).toBeVisible();
  });

  test("nav-help is visible to anonymous and signed-in users", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(tid("nav-help"))).toBeVisible();
    await loginAs(page, "bob");
    await page.reload();
    await expect(page.locator(tid("nav-help"))).toBeVisible();
    await logout(page);
  });
});
