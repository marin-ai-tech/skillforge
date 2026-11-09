// Acceptance e2e for importing from sources. Users: alice (contributor), bob (viewer).
// Imports plugin-sample.zip: csv-tools, deploy, reviewer-bot, ops-plugin, power-grid (new names).
import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { ROOT } from "./state.ts";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const ZIP = join(ROOT, "tests", "fixtures", "imports", "plugin-sample.zip");

test.describe("import", () => {
  test("viewer → import-forbidden; anonymous → sign-in", async ({ page }) => {
    await page.goto("/import");
    await expect(page).toHaveURL(/\/login\?next=/);
    await loginAs(page, "bob");
    await page.goto("/import");
    await expect(page.locator(tid("import-forbidden"))).toBeVisible();
    await logout(page);
  });

  test("zip: preview, run, cards; repeat — conflicts and skipped", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.locator(tid("nav-user")).click();
    await page.locator(tid("menu-import")).click();
    await expect(page).toHaveURL(/\/import$/);
    await expect(page).toHaveTitle(/^Import · SkillForge/);
    await page.locator(tid("import-source")).selectOption("zip");
    await page.locator(tid("import-zip-input")).setInputFiles(ZIP);
    await page.locator(tid("import-preview")).click();
    const rows = page.locator(tid("import-candidate"));
    await expect(rows).toHaveCount(5);
    for (const id of ["skill/csv-tools", "command/deploy", "agent/reviewer-bot", "hook/ops-plugin", "skill/power-grid"]) {
      await expect(page.locator(`${tid("import-candidate")}[data-id="${id}"]`)).toContainText(/Ready|Warnings/);
    }
    await expect(page.locator(tid("import-skipped"))).toContainText("node_modules");
    await expect(page.locator(tid("import-run"))).toBeEnabled();
    await page.locator(tid("import-run")).click();
    const results = page.locator(tid("import-result"));
    await expect(results).toHaveCount(5);
    await expect(page.locator(`${tid("import-result")}[data-status="created"]`)).toHaveCount(5);
    await page.locator(`${tid("import-result")}[data-id="skill/csv-tools"] a`).first().click();
    await expect(page).toHaveURL(/\/artifacts\/skill\/csv-tools/);
    await expect(page.locator(tid("detail-version"))).toContainText("0.1.0");
    await expect(page.locator(tid("meta-provenance"))).toContainText("human");

    await page.goto("/import");
    await page.locator(tid("import-source")).selectOption("zip");
    await page.locator(tid("import-zip-input")).setInputFiles(ZIP);
    await page.locator(tid("import-preview")).click();
    await expect(page.locator(tid("import-candidate"))).toHaveCount(5);
    await expect(page.locator(`${tid("import-candidate")}[data-id="command/deploy"]`)).toContainText("Conflict");
    await page.locator(tid("import-run")).click();
    await expect(page.locator(`${tid("import-result")}[data-status="skipped"]`)).toHaveCount(5);
    await logout(page);
  });

  test("reckon provenance of an imported learned-skill", async ({ page }) => {
    await page.goto("/artifacts/skill/power-grid");
    await expect(page.locator(tid("meta-provenance"))).toContainText("reckon");
    await expect(page.locator(tid("meta-provenance"))).toContainText(".reckon/skills/power-grid.md");
  });
});
