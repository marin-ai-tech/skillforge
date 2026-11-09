// Acceptance e2e for agent inventory in the UI. The file is deliberately named `zz-…`: it runs
// last (Playwright goes alphabetically, workers = 1), because publishing from a snapshot creates the artifact
// `skill/local-notes` and the version `command/propose`, while catalog.spec counts the cards on the home page.
import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { loginAs, logout } from "./auth-helpers.ts";
import { ROOT } from "./state.ts";
import { readFileSync } from "node:fs";

const tid = (id: string) => `[data-testid="${id}"]`;
const AGENT_FIXTURES = join(ROOT, "tests", "fixtures", "agents");
const agentRoot = () => {
  const state = JSON.parse(readFileSync(join(ROOT, "tests", "e2e", ".e2e-state.json"), "utf8")) as { dataDir: string };
  return join(state.dataDir, "agent-roots");
};

test.describe("agents in the UI", () => {
  test("alice adds an agent from a folder and sees the summary", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/me/agents");
    await expect(page).toHaveTitle(/Agents · SkillForge/);
    await expect(page.locator(tid("agents-empty"))).toContainText("skillforge agent scan");
    await page.locator(tid("agent-add")).click();
    await expect(page.locator(tid("agent-add-dialog"))).toBeVisible();
    await page.locator(tid("agent-name")).fill("laptop");
    await page.locator(tid("agent-folder")).setInputFiles(join(AGENT_FIXTURES, "laptop"));
    await page.locator(tid("agent-add-submit")).click();
    await expect(page).toHaveURL(/\/me\/agents\/laptop$/);
    await expect(page).toHaveTitle(/laptop · Agents · SkillForge/);
    // In the test setup the latest pdf-tools version is 0.2.0, in the folder 0.1.0 → outdated (robust to spec order).
    await expect(page.locator(tid("agent-summary-outdated"))).toContainText("1");
    await expect(page.locator(tid("agent-summary-local_only"))).toContainText("1");
    await expect(page.locator(tid("agent-summary-modified"))).toContainText("1");
    await expect(page.locator(`${tid("agent-item")}[data-key="skill/pdf-tools"]`)).toHaveAttribute("data-status", "outdated");
    await expect(page.locator(`${tid("agent-item")}[data-key="skill/pdf-tools"] ${tid("agent-item-install")}`)).toContainText("skillforge install skill/pdf-tools");
    await expect(page.locator(`${tid("agent-item")}[data-key="command/propose"] ${tid("agent-item-changed")}`)).toContainText("commands/propose.md");
    await expect(page.locator(tid("agent-refresh-hint"))).toContainText("skillforge agent scan");
    await page.goto("/me/agents");
    await expect(page.locator(tid("agents-empty"))).toHaveCount(0);
    const row = page.locator(tid("agent-row")).filter({ hasText: "laptop" });
    await expect(row).toHaveCount(1);
    await expect(row.locator(tid("agent-kind"))).toHaveText("upload");
    // Dashboard: an agent with a summary and the "needs attention" counter (outdated + modified > 0).
    await page.goto("/me");
    const meAgent = page.locator(`${tid("me-agent")}[data-name="laptop"]`);
    await expect(meAgent.locator(tid("me-agent-summary-outdated"))).toContainText("1");
    await expect(meAgent.locator(tid("me-agent-summary-modified"))).toContainText("1");
    await expect(page.locator(tid("me-agents-attention"))).toContainText("1");
    await logout(page);
  });

  test("alice publishes a local skill from a snapshot, filters and the install hint", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/me/agents/laptop");
    await page.locator(tid("agent-filter-local_only")).click();
    await expect(page.locator(tid("agent-item"))).toHaveCount(1);
    const notes = page.locator(`${tid("agent-item")}[data-key="skill/local-notes"]`);
    await notes.locator(tid("agent-item-publish")).click();
    await expect(page.locator(tid("dialog-confirm"))).toBeVisible();
    await page.locator(tid("dialog-confirm")).click();
    await expect(page.locator(tid("agent-notice"))).toContainText("skill/local-notes@0.1.0");
    await page.locator(tid("agent-filter-all")).click();
    await expect(page.locator(`${tid("agent-item")}[data-key="skill/local-notes"]`)).toHaveAttribute("data-status", "in_sync");
    await expect(page.locator(tid("agent-summary-local_only"))).toContainText("0");
    await expect(page.locator(`${tid("agent-item")}[data-key="skill/local-notes"] a`).first()).toHaveAttribute("href", "/artifacts/skill/local-notes");
    // Other specs change active statuses in the test setup (sweep/revalidate), so we take all except retired:
    // agent/handoff-executor stays candidate for the whole run.
    await page.locator(tid("agent-registry-all")).click();
    await page.locator(tid("agent-filter-registry_only")).click();
    await expect(page.locator(`${tid("agent-item")}[data-key="agent/handoff-executor"]`)).toHaveAttribute("data-status", "registry_only");
    const installHint = page.locator(tid("agent-item-install")).first();
    await expect(installHint).toContainText("skillforge install ");
    await expect(page.locator(tid("agent-item-publish"))).toHaveCount(0);
    await logout(page);
  });

  test("bob (viewer): own folder, no publish button, agent deletion", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/me/agents");
    await page.locator(tid("agent-add")).click();
    await page.locator(tid("agent-name")).fill("bobs");
    await page.locator(tid("agent-folder")).setInputFiles(join(AGENT_FIXTURES, "bobs"));
    await page.locator(tid("agent-add-submit")).click();
    await expect(page).toHaveURL(/\/me\/agents\/bobs$/);
    await expect(page.locator(tid("agent-summary-local_only"))).toContainText("1");
    await expect(page.locator(tid("agent-item-publish"))).toHaveCount(0);
    await page.goto("/me/agents/laptop");
    await expect(page.locator(tid("agent-missing"))).toBeVisible();
    await page.goto("/me/agents");
    const row = page.locator(tid("agent-row")).filter({ hasText: "bobs" });
    await row.locator(tid("agent-delete")).click();
    await page.locator(tid("dialog-confirm")).click();
    await expect(page.locator(tid("agent-row")).filter({ hasText: "bobs" })).toHaveCount(0);
    await expect(page.locator(tid("agents-empty"))).toBeVisible();
    await logout(page);
  });

  // Uploading a folder sends only artifact files; secrets stay in the browser.
  test("bob uploads a folder with secrets: only artifact files go to the server", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/me/agents");
    await page.locator(tid("agent-add")).click();
    await page.locator(tid("agent-name")).fill("with-secrets");
    await page.locator(tid("agent-folder")).setInputFiles(join(AGENT_FIXTURES, "with-secrets"));
    const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().includes("/api/v1/me/agents/with-secrets"));
    await page.locator(tid("agent-add-submit")).click();
    const body = (await put).postData() ?? "";
    expect(body).not.toContain("FAKE-SECRET-");
    expect(body).not.toContain("settings.local.json");
    expect(body).not.toContain("auth.json");
    expect(body).not.toContain("config.toml");
    await expect(page).toHaveURL(/\/me\/agents\/with-secrets$/);
    await expect(page.locator(`${tid("agent-item")}[data-key="skill/notes-keeper"]`)).toHaveCount(1);
    await expect(page.locator(`${tid("agent-item")}[data-key="command/review"]`)).toHaveCount(1);
    await page.goto("/me/agents");
    const row = page.locator(tid("agent-row")).filter({ hasText: "with-secrets" });
    await row.locator(tid("agent-delete")).click();
    await page.locator(tid("dialog-confirm")).click();
    await expect(page.locator(tid("agent-row")).filter({ hasText: "with-secrets" })).toHaveCount(0);
    await logout(page);
  });

  test("admin: server agent in the admin area, roots, path error, rescan, deletion", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await page.goto("/admin/agents");
    await expect(page).toHaveTitle(/Agents administration · SkillForge/);
    await expect(page.locator(tid("agent-roots"))).toContainText("agent-roots");
    await expect(page.locator(tid("agent-roots-disabled"))).toHaveCount(0);
    await page.locator(tid("server-agent-name")).fill("ci-runner");
    await page.locator(tid("server-agent-path")).fill(join(agentRoot(), "..", "outside"));
    await page.locator(tid("server-agent-submit")).click();
    await expect(page.locator(tid("admin-error"))).toContainText("path_outside_roots");
    await page.locator(tid("server-agent-path")).fill(join(agentRoot(), "runner", ".claude"));
    await page.locator(tid("server-agent-submit")).click();
    await expect(page.locator(tid("admin-notice"))).toBeVisible();
    const row = page.locator(tid("admin-agent-row")).filter({ hasText: "ci-runner" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("admin");
    await expect(row).toContainText("server");
    await row.locator(tid("admin-agent-scan")).click();
    await expect(page.locator(tid("admin-notice"))).toBeVisible();
    await row.locator("a").first().click();
    await expect(page).toHaveURL(/\/me\/agents\/ci-runner$/);
    await expect(page.locator(tid("agent-rescan"))).toBeVisible();
    await page.locator(tid("agent-rescan")).click();
    await expect(page.locator(tid("agent-notice"))).toBeVisible();
    await page.goto("/admin/agents");
    await page.locator(tid("admin-agent-row")).filter({ hasText: "ci-runner" }).locator(tid("admin-agent-delete")).click();
    await page.locator(tid("dialog-confirm")).click();
    await expect(page.locator(tid("admin-agent-row")).filter({ hasText: "ci-runner" })).toHaveCount(0);
    await logout(page);
  });

  test("access and menu", async ({ page }) => {
    await page.goto("/me/agents");
    await expect(page).toHaveURL(/\/login\?next=%2Fme%2Fagents|\/login\?next=\/me\/agents/);
    await loginAs(page, "bob");
    await page.goto("/");
    await page.locator(tid("nav-user")).click();
    await expect(page.locator(tid("user-menu")).locator(tid("menu-agents"))).toBeVisible();
    await expect(page.locator(tid("menu-admin-agents"))).toHaveCount(0);
    await page.goto("/admin/agents");
    await expect(page.locator(tid("admin-forbidden"))).toBeVisible();
    await logout(page);
    await loginAs(page, "admin");
    await page.goto("/");
    await page.locator(tid("nav-user")).click();
    await expect(page.locator(tid("user-menu")).locator(tid("menu-admin-agents"))).toBeVisible();
    await logout(page);
  });
});
