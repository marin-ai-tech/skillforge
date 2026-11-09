// E2E: interface language with English alone. The language switch
// is shown only when a second dictionary is built; a browser language without a dictionary gets English; an error by
// code shows its code; the page sweep finds no text in a non-Latin script in the English interface. Code and monospace
// text (commands, identifiers, versions, digests), inputs, everything marked translate="no" (artifact contents, user
// names) and help topic bodies are excluded from the sweep.
import { test, expect, type Page } from "@playwright/test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { loginAs, logout } from "./auth-helpers.ts";
import { ROOT } from "./state.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

/** Languages the web app is built with: English plus every dictionary `i18n/<code>.ts` (as `i18n/index.ts` finds them). */
const BUILT_LANGS = [
  "en",
  ...readdirSync(join(ROOT, "packages", "web", "src", "i18n"))
    .filter((n) => /^[a-z]{2,3}\.ts$/.test(n) && n !== "en.ts")
    .map((n) => n.slice(0, -3)),
].sort();

const PAGES = [
  "/",
  "/artifacts",
  "/artifacts/skill/pdf-tools",
  "/artifacts/skill/pdf-tools?tab=files",
  "/artifacts/skill/pdf-tools?tab=versions",
  "/artifacts/skill/pdf-tools?tab=audit",
  "/artifacts/skill/pdf-tools?tab=install",
  "/artifacts/skill/pdf-tools?tab=quality",
  "/artifacts/skill/pdf-tools?tab=evidence",
  "/artifacts/skill/pdf-tools?tab=comments",
  "/publish",
  "/import",
  "/start",
  "/lifecycle",
  "/metrics",
  "/teams",
  "/me",
  "/me/tokens",
  "/me/agents",
  "/me/notifications",
  "/me/password",
  "/admin/users",
  "/admin/backups",
  "/admin/plugins",
  "/admin/agents",
  "/admin/lifecycle",
];

/** Visible interface text: without noscript, code, monospace, inputs, translate="no" content and help topic bodies. */
async function chromeText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const skip =
      'script, style, noscript, code, pre, kbd, input, textarea, select option, .font-mono, [translate="no"], [data-testid="help-panel-body"]';
    // Text nodes joined by spaces: innerText glues adjacent inline elements (a status chip and a grade letter).
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || el.closest(skip) || !el.checkVisibility()) continue;
      parts.push(n.textContent ?? "");
    }
    return parts.join(" ");
  });
}

/** Words that contain a letter of a script other than Latin (Common letters such as the micro sign do not count). */
const NON_LATIN_WORD = /\S*(?![\p{Script=Latin}\p{Script=Common}])\p{L}\S*/gu;

test.describe("interface language", () => {
  test("the language switch is shown only when a second language is built, and lists exactly the built languages", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator(tid("theme-toggle"))).toBeVisible();
    const sw = page.locator(tid("lang-switch"));
    if (BUILT_LANGS.length < 2) {
      await expect(sw).toHaveCount(0);
      return;
    }
    await expect(sw).toBeVisible();
    const values = await sw.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect([...values].sort()).toEqual(BUILT_LANGS);
    await expect(sw).toHaveValue("en");
  });

  test("an error by code: the code and an English message are visible", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/publish");
    await page.locator(tid("publish-mode-paste")).click();
    await page.locator(tid("publish-paste-filename")).fill("SKILL.md");
    await page.locator(tid("publish-paste")).fill("---\nname: no-description\n---\n\nBody.\n");
    const issue = page.locator(`${tid("publish-issue")}[data-code="E_DESCRIPTION_MISSING"]`);
    await expect(issue).toBeVisible();
    await expect(issue).toContainText("E_DESCRIPTION_MISSING");
    const message = (await issue.innerText()).replace("E_DESCRIPTION_MISSING", "");
    expect(message).toMatch(/[A-Za-z]{3,}/);
    expect(message.match(NON_LATIN_WORD)).toBeNull();
    await logout(page);
  });

  test("no mixed languages on the pages (en)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await loginAs(page, "admin");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const problems: string[] = [];
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const text = await chromeText(page);
      const foreign = text.match(NON_LATIN_WORD);
      if (foreign) problems.push(`${path}: non-Latin text ${[...new Set(foreign)].slice(0, 5).join(", ")}`);
    }
    await logout(page);
    expect(problems).toEqual([]);
  });
});

test.describe("browser language", () => {
  test.describe("de-DE", () => {
    test.use({ locale: "de-DE" });
    test("a language without a dictionary gets English", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    });
  });
});
