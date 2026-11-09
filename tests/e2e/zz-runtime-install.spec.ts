// Acceptance e2e: runtime selection on
// the Install tab — an install command or the reason it is unsupported.
// The `zz-…` name makes it publish its artifacts after the other specs, so as not to change their counters.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const b64 = (s: string) => Buffer.from(s).toString("base64");

test.describe("install for a runtime", () => {
  test("skill — command for the selected runtime; command for Codex — a reason", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    const skill = `---\nname: rt-notes\ndescription: Writes release notes from merged pull requests. Use when preparing a release.\n---\n\n# Release notes\n\nCollect merged PRs and group them by label.\n`;
    const cmd = `---\ndescription: Summarizes a file for the changelog.\n---\n\nSummarize $ARGUMENTS in one line.\n`;
    for (const [type, name, files] of [
      ["skill", "rt-notes", [{ path: "rt-notes/SKILL.md", content_base64: b64(skill) }]],
      ["command", "rt-summarize", [{ path: "rt-summarize.md", content_base64: b64(cmd) }]],
    ] as const) {
      const p = await page.request.post("/api/v1/artifacts", { data: { type, files } });
      expect(p.status(), await p.text()).toBe(201);
      const t = await page.request.post(`/api/v1/artifacts/${type}/${name}/transitions`, { data: { to: "active", reason: "e2e" } });
      expect(t.status(), await t.text()).toBe(200);
    }

    await page.goto("/artifacts/skill/rt-notes?tab=install");
    const block = page.locator(tid("install-runtime"));
    await expect(block).toBeVisible();
    await expect(page.locator(tid("install-runtime-cmd"))).toContainText("skillforge install skill/rt-notes --runtime claude-code");
    await page.locator(tid("install-runtime-select")).selectOption("gemini");
    await expect(page.locator(tid("install-runtime-cmd"))).toContainText("skillforge install skill/rt-notes --runtime gemini");
    await expect(block.getByRole("button", { name: /^Copy$/ })).toHaveCount(1);

    await page.goto("/artifacts/command/rt-summarize?tab=install");
    await page.locator(tid("install-runtime-select")).selectOption("codex");
    await expect(page.locator(tid("install-runtime-cmd"))).toHaveCount(0);
    await expect(page.locator(tid("install-runtime-unsupported"))).toContainText(/skill/i);
    await page.locator(tid("install-runtime-select")).selectOption("gemini");
    await expect(page.locator(tid("install-runtime-cmd"))).toContainText("--runtime gemini");
    await logout(page);
  });

  test("not active — no runtime selection block", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools?tab=install");
    await expect(page.locator(tid("install-not-active"))).toBeVisible();
    await expect(page.locator(tid("install-runtime"))).toHaveCount(0);
  });
});
