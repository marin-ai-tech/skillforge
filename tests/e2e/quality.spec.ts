// Quality UI: the quality tab, the grade in lists, quality and duplicates on publish, duplicates in an agent folder.
// The created agent is deleted at the end (zz-agents.spec expects alice's agent list to be empty).
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loginAs, logout } from "./auth-helpers.ts";
import { ROOT } from "./state.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const WEAK_DIR = join(ROOT, "tests", "fixtures", "quality", "weak", "quality-weak");
const WEAK_SKILL = readFileSync(join(WEAK_DIR, "SKILL.md"), "utf8");
const b64 = (s: string) => Buffer.from(s).toString("base64");
const weakFiles = (name: string) => [
  { path: `${name}/SKILL.md`, content_base64: b64(WEAK_SKILL.replace("name: quality-weak", `name: ${name}`)) },
  { path: `${name}/references/A.md`, content_base64: b64(readFileSync(join(WEAK_DIR, "references", "A.md"), "utf8")) },
  { path: `${name}/references/B.md`, content_base64: b64(readFileSync(join(WEAK_DIR, "references", "B.md"), "utf8")) },
];

async function publish(page: Page, name: string) {
  const r = await page.request.post("/api/v1/artifacts", { data: { type: "skill", files: weakFiles(name) } });
  expect(r.status(), await r.text()).toBe(201);
}

test.describe("quality in the UI", () => {
  test("hook: event → condition → action table, blocking modes, risk badge with row highlighting", async ({ page }) => {
    await page.goto("/artifacts/hook/destructive-guard?tab=quality");
    await expect(page.locator(tid("tab-quality"))).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(tid("quality-grade"))).toHaveAttribute("data-grade", "A");
    const rows = page.locator(`${tid("hook-table")} ${tid("hook-row")}`);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-event", "PreToolUse");
    await expect(rows.nth(0)).toHaveAttribute("data-blocking", "ask");
    await expect(rows.nth(0)).toContainText("Bash");
    await expect(rows.nth(1)).toHaveAttribute("data-event", "Stop");
    await expect(rows.nth(1)).toHaveAttribute("data-blocking", "unknown");
    const risk = page.locator(`${tid("hook-risk")}[data-label="llm_hook"]`);
    await expect(risk).toBeVisible();
    // Row count on the badge and a visible block are covered here.
    await expect(risk.locator(tid("hook-risk-count"))).toHaveText("1");
    await risk.click();
    await expect(rows.nth(1)).toHaveAttribute("data-highlight", "true");
    await expect(rows.nth(0)).not.toHaveAttribute("data-highlight", "true");
    await expect(page.locator(tid("quality-clean"))).toBeVisible();
  });

  test("weak skill and its copy: grade D, findings with help, identical_body duplicate; grade in the dashboard", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await publish(page, "quality-weak");
    await publish(page, "quality-weak-copy");
    await page.goto("/artifacts/skill/quality-weak-copy?tab=quality");
    await expect(page.locator(tid("quality-grade"))).toHaveAttribute("data-grade", "D");
    await expect(page.locator(tid("quality-score"))).toContainText("10");
    const check = page.locator(`${tid("quality-check")}[data-code="Q_DESC_SHORT"]`);
    await expect(check).toHaveAttribute("data-severity", "warn");
    await expect(page.locator(`${tid("quality-check")}[data-code="Q_TIME_SENSITIVE"]`)).toContainText("SKILL.md:");
    await check.locator(tid("quality-check-help")).click();
    await expect(page.locator(tid("help-panel"))).toContainText("Q_DESC_SHORT");
    await page.locator(tid("help-close")).click();
    const dup = page.locator(`${tid("quality-duplicates")} ${tid("duplicate-item")}[data-kind="identical_body"]`);
    await expect(dup).toHaveCount(1);
    await expect(dup.locator('a[href="/artifacts/skill/quality-weak"]')).toHaveCount(1);
    await expect(page.locator(tid("hook-table"))).toHaveCount(0);

    await page.goto("/me");
    await expect(page.locator(`${tid("me-artifact")}[data-key="skill/quality-weak"] ${tid("me-artifact-grade")}`)).toHaveText("D");
    await logout(page);
  });

  test("grade in the catalog and in the review queue", async ({ page }) => {
    await page.goto("/artifacts?q=quality-weak");
    const card = page.locator(`${tid("artifact-card")}[data-name="quality-weak"]`);
    await expect(card.locator(tid("artifact-grade"))).toHaveText("D");
    await expect(card.locator(tid("artifact-grade"))).toHaveAttribute("data-grade", "D");
    await page.goto("/");
    await loginAs(page, "rita");
    await page.goto("/lifecycle");
    const queued = page.locator(`${tid("artifact-card")}[data-name="quality-weak-copy"]`);
    await expect(queued.locator(tid("artifact-grade"))).toHaveText("D");
    await logout(page);
  });

  test("publish: quality and duplicates blocks after the check, the publish button is available", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/publish");
    await page.locator(tid("publish-mode-paste")).click();
    await page.locator(tid("publish-paste-filename")).fill("SKILL.md");
    await page.locator(tid("publish-paste")).fill(WEAK_SKILL.replace("name: quality-weak", "name: quality-weak-paste"));
    await expect(page.locator(tid("publish-summary"))).toBeVisible();
    await expect(page.locator(tid("publish-quality-grade"))).toHaveText("D");
    await expect(page.locator(`${tid("publish-quality")} ${tid("quality-check")}[data-code="Q_DESC_SHORT"]`)).toHaveCount(1);
    await expect(page.locator(`${tid("publish-duplicates")} ${tid("duplicate-item")}[data-kind="identical_body"]`).first()).toBeVisible();
    await expect(page.locator(tid("publish-submit"))).toBeEnabled();
    await logout(page);
  });

  test("agent page: duplicate groups with a recommended root", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    const md = (name: string, body: string) => b64(`---\nname: ${name}\ndescription: Duplicate probe ${name} for the agent page. Use when testing duplicates.\n---\n\n${body}\n`);
    const put = await page.request.put("/api/v1/me/agents/dups-e2e", {
      data: {
        files: [
          { path: ".claude/skills/dup-skill/SKILL.md", content_base64: md("dup-skill", "Same.") },
          { path: ".agents/skills/dup-skill/SKILL.md", content_base64: md("dup-skill", "Same.") },
          { path: ".claude/skills/div-skill/SKILL.md", content_base64: md("div-skill", "Version A.") },
          { path: "skills/div-skill/SKILL.md", content_base64: md("div-skill", "Version B.") },
          { path: ".claude/skills/note/SKILL.md", content_base64: md("note", "Current.") },
          { path: ".claude/skills/note.bak/SKILL.md", content_base64: md("note", "Old.") },
        ],
      },
    });
    expect(put.status(), await put.text()).toBe(200);
    try {
      await page.goto("/me/agents/dups-e2e");
      const groups = page.locator(`${tid("agent-duplicates")} ${tid("agent-duplicate")}`);
      await expect(groups).toHaveCount(3);
      await expect(page.locator(`${tid("agent-duplicate")}[data-key="skill/dup-skill"]`)).toHaveAttribute("data-class", "replica");
      await expect(page.locator(`${tid("agent-duplicate")}[data-key="skill/div-skill"]`)).toHaveAttribute("data-class", "divergent");
      await expect(page.locator(`${tid("agent-duplicate")}[data-key="skill/note"]`)).toHaveAttribute("data-class", "stale_backup");
      for (let i = 0; i < 3; i++) {
        await expect(groups.nth(i).locator(tid("agent-duplicate-keep"))).toHaveCount(1);
      }
      await expect(page.locator(`${tid("agent-duplicate")}[data-key="skill/note"] ${tid("agent-duplicate-keep")}`)).toContainText(".claude/skills/note");
    } finally {
      await page.request.delete("/api/v1/me/agents/dups-e2e");
    }
    await page.goto("/me/agents/dups-e2e");
    await logout(page);
  });
});
