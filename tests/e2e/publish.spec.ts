// Publish page e2e tests. Runs after catalog.spec.ts
// (alphabetical order, one worker) and publishes only new names.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "./state.ts";
import { loginAs } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const reckon = readFileSync(join(FIXTURES, "skill-reckon", "nutrition-migration.md"), "utf8");

async function pasteMarkdown(page: import("@playwright/test").Page, filename: string, text: string) {
  await page.goto("/publish");
  await page.locator(tid("publish-mode-paste")).click();
  await page.locator(tid("publish-paste-filename")).fill(filename);
  await page.locator(tid("publish-paste")).fill(text);
}

test.describe("publish page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
  });

  test("navigation link and title", async ({ page }) => {
    await page.goto("/");
    await page.locator(tid("nav-publish")).click();
    await expect(page).toHaveURL(/\/publish$/);
    await expect(page).toHaveTitle(/^Publish · SkillForge/);
    await expect(page.locator(tid("publish-dropzone"))).toBeVisible();
    await expect(page.locator(tid("publish-submit"))).toBeDisabled();
  });

  test("publishing a skill folder via directory selection", async ({ page }) => {
    await page.goto("/publish");
    await page.locator(tid("publish-dir-input")).setInputFiles(join(FIXTURES, "skill-e2e", "pdf-tools-e2e"));
    await expect(page.locator(`${tid("publish-files")} ${tid("publish-file")}`)).toHaveCount(2);
    const summary = page.locator(tid("publish-summary"));
    await expect(summary).toContainText("skill");
    await expect(summary).toContainText("pdf-tools-e2e");
    await expect(summary).toContainText("0.1.0");
    await expect(page.locator(tid("publish-type"))).toHaveValue("skill");
    await expect(page.locator(tid("publish-version"))).toHaveAttribute("placeholder", /0\.1\.0/);
    await expect(page.locator(tid("publish-submit"))).toBeEnabled();
    await page.locator(tid("publish-submit")).click();
    await expect(page).toHaveURL(/\/artifacts\/skill\/pdf-tools-e2e/);
    await expect(page.locator(tid("publish-success"))).toBeVisible();
    await expect(page.locator(tid("detail-version"))).toContainText("0.1.0");
    await page.locator(tid("tab-files")).click();
    await expect(page.locator(`${tid("file-entry")}[data-path="skills/pdf-tools-e2e/references/REFERENCE.md"]`)).toBeVisible();
  });

  test("validation error is shown before submit, the button is disabled", async ({ page }) => {
    await pasteMarkdown(page, "SKILL.md", "---\nname: Bad Name\ndescription: Broken skill.\n---\n\nBody.\n");
    const issue = page.locator(`${tid("publish-errors")} ${tid("publish-issue")}[data-code="E_NAME_INVALID"]`);
    await expect(issue).toBeVisible();
    await expect(issue).toHaveAttribute("data-level", "error");
    await expect(page.locator(tid("publish-submit"))).toBeDisabled();
  });

  test("Reckon learned-skill: warnings do not block, publication succeeds", async ({ page }) => {
    await pasteMarkdown(page, "nutrition-migration.md", reckon);
    await expect(page.locator(`${tid("publish-warnings")} ${tid("publish-issue")}[data-code="W_SINGLE_FILE_SKILL"]`)).toHaveCount(1);
    await expect(page.locator(`${tid("publish-warnings")} ${tid("publish-issue")}[data-code="W_UNKNOWN_FRONTMATTER_KEY"]`).first()).toBeVisible();
    await expect(page.locator(tid("publish-errors")).locator(tid("publish-issue"))).toHaveCount(0);
    await expect(page.locator(tid("publish-submit"))).toBeEnabled();
    await page.locator(tid("publish-submit")).click();
    await expect(page).toHaveURL(/\/artifacts\/skill\/nutrition-migration/);
    await expect(page.locator(tid("detail-version"))).toContainText("0.1.0");
  });

  test("pasting the same file again → digest conflict, the button is disabled", async ({ page }) => {
    await pasteMarkdown(page, "nutrition-migration.md", reckon);
    await expect(page.locator(`${tid("publish-conflict")}[data-conflict="digest_exists"]`)).toBeVisible();
    await expect(page.locator(tid("publish-summary"))).toContainText("0.1.0");
    await expect(page.locator(tid("publish-submit"))).toBeDisabled();
  });

  test("agent type hint and manual command selection", async ({ page }) => {
    await pasteMarkdown(page, "paste-agent.md", "---\nname: paste-agent\ndescription: Pasted agent for e2e.\nmodel: sonnet\n---\nYou are a pasted agent.\n");
    await expect(page.locator(tid("publish-type"))).toHaveValue("agent");
    await expect(page.locator(tid("publish-summary"))).toContainText("agent");
    await page.locator(tid("publish-type")).selectOption("command");
    await expect(page.locator(tid("publish-summary"))).toContainText("command");
    await expect(page.locator(tid("publish-submit"))).toBeEnabled();
  });

  test("explicit version and changelog reach the card", async ({ page }) => {
    await pasteMarkdown(page, "paste-cmd.md", "---\ndescription: Pasted command for e2e.\n---\nDeploy the current branch to staging.\n");
    await page.locator(tid("publish-type")).selectOption("command");
    await page.locator(tid("publish-version")).fill("1.2.3");
    await page.locator(tid("publish-changelog")).fill("Initial e2e command");
    await expect(page.locator(tid("publish-summary"))).toContainText("1.2.3");
    await expect(page.locator(tid("publish-submit"))).toBeEnabled();
    await page.locator(tid("publish-submit")).click();
    await expect(page).toHaveURL(/\/artifacts\/command\/paste-cmd/);
    await expect(page.locator(tid("detail-version"))).toContainText("1.2.3");
    await page.locator(tid("tab-versions")).click();
    await expect(page.locator(`${tid("version-entry")}[data-version="1.2.3"]`)).toContainText("Initial e2e command");
  });

  test("removing a file from the list recomputes the dry run", async ({ page }) => {
    await page.goto("/publish");
    await page.locator(tid("publish-dir-input")).setInputFiles(join(FIXTURES, "skill-standard", "pdf-tools"));
    await expect(page.locator(`${tid("publish-files")} ${tid("publish-file")}`)).toHaveCount(2);
    await expect(page.locator(`${tid("publish-conflict")}[data-conflict="digest_exists"]`)).toBeVisible();
    await page.locator(`${tid("publish-file")}[data-path$="REFERENCE.md"] button`).click();
    await expect(page.locator(`${tid("publish-files")} ${tid("publish-file")}`)).toHaveCount(1);
    await expect(page.locator(`${tid("publish-warnings")} ${tid("publish-issue")}[data-code="W_REFERENCE_MISSING"]`)).toBeVisible();
  });
});
