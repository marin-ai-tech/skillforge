// Acceptance e2e tests for which agents and versions an artifact targets: badges on the catalog card, the "Agents" section on
// Overview (with the reason if the type cannot be installed), the catalog "Agent" filter and editing the
// declaration by the owner in metadata.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const NAME = "e2e-agents-skill";
const skillMd = `---\nname: ${NAME}\ndescription: Skill declared for Claude Code 2.1+ and Codex, used by the agents e2e.\n---\n\n# Agents\n\nDo the task.\n`;

test.describe.serial("agent compatibility", () => {
  test("the declaration is visible on the card and in the Agents section", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    const r = await page.request.post("/api/v1/artifacts", {
      data: {
        type: "skill",
        files: [{ path: `${NAME}/SKILL.md`, content_base64: Buffer.from(skillMd).toString("base64") }],
        agents: [{ runtime: "claude-code", min_version: "2.1" }, { runtime: "codex" }],
      },
    });
    expect(r.status(), await r.text()).toBe(201);

    await page.goto(`/artifacts?q=${NAME}`);
    const card = page.locator(`${tid("artifact-card")}[data-name="${NAME}"]`);
    const badges = card.locator(tid("artifact-agents-badges"));
    await expect(badges).toContainText("Claude Code ≥ 2.1");
    await expect(badges).toContainText("Codex");
    await expect(badges).not.toContainText("Cursor");

    await page.goto(`/artifacts/skill/${NAME}`);
    const section = page.locator(tid("artifact-agents"));
    await expect(section).toBeVisible();
    await expect(section.locator(tid("agent-row"))).toHaveCount(8);
    await expect(section.locator(`${tid("agent-row")}[data-runtime="claude-code"]`)).toContainText("2.1");
    await expect(section.locator(`${tid("agent-row")}[data-runtime="claude-code"]`)).toHaveAttribute("data-declared", "true");
    await expect(section.locator(`${tid("agent-row")}[data-runtime="cursor"]`)).toHaveAttribute("data-declared", "false");
    await logout(page);
  });

  test("hook: the Agents section explains why it is not installed into other agents", async ({ page }) => {
    await page.goto("/artifacts/hook/destructive-guard");
    const section = page.locator(tid("artifact-agents"));
    await expect(section.locator(`${tid("agent-row")}[data-runtime="claude-code"]`)).toHaveAttribute("data-supported", "true");
    const codex = section.locator(`${tid("agent-row")}[data-runtime="codex"]`);
    await expect(codex).toHaveAttribute("data-supported", "false");
    await expect(codex).toContainText(/hook/i);
  });

  test("catalog Agent filter: in the URL, without hooks and without artifacts whose declaration omits this agent", async ({ page }) => {
    await page.goto("/artifacts");
    await page.locator(tid("filter-agent")).selectOption("cursor");
    await expect(page).toHaveURL(/agent=cursor/);
    await expect(page.locator(`${tid("artifact-card")}[data-type="skill"]`).first()).toBeVisible();
    await expect(page.locator(`${tid("artifact-card")}[data-type="hook"]`)).toHaveCount(0);
    await expect(page.locator(`${tid("artifact-card")}[data-name="${NAME}"]`)).toHaveCount(0);
    await page.locator(tid("filter-agent")).selectOption("codex");
    await expect(page.locator(`${tid("artifact-card")}[data-name="${NAME}"]`)).toBeVisible();
  });

  test("the owner changes the declaration in metadata", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto(`/artifacts/skill/${NAME}`);
    const input = page.locator(tid("metadata-agents"));
    await expect(input).toHaveValue("claude-code>=2.1, codex");
    await input.fill("opencode>=1.0");
    await page.locator(tid("metadata-save")).click();
    await expect(page.locator(`${tid("agent-row")}[data-runtime="opencode"]`)).toHaveAttribute("data-declared", "true");
    await expect(page.locator(`${tid("agent-row")}[data-runtime="codex"]`)).toHaveAttribute("data-declared", "false");
    await input.fill("hookless-agent");
    await page.locator(tid("metadata-save")).click();
    await expect(page.locator(tid("metadata-error-agents"))).toContainText("hookless-agent");
    await logout(page);
  });
});
