// Acceptance e2e tests for the "Review" tab with plugin action buttons: starting a review, findings, the reviewer's decision.
// The e2e stand loads the `plugins/review-assistant` plugin and a reviewers file with mocks (see global-setup).
// The `zz-...` name makes it publish its own artifact after the other specs.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const b64 = (s: string) => Buffer.from(s).toString("base64");

test.describe("review assistant", () => {
  test("reviewer starts a review with a button, sees the merged findings and makes a decision", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "rita");
    const skill = `---\nname: rt-review-notes\ndescription: Drafts release notes. Use when a release is being prepared.\n---\n\n# Notes\n\nAlways use the latest version of the tool.\n`;
    const pub = await page.request.post("/api/v1/artifacts", { data: { type: "skill", files: [{ path: "rt-review-notes/SKILL.md", content_base64: b64(skill) }] } });
    expect(pub.status(), await pub.text()).toBe(201);

    await page.goto("/artifacts/skill/rt-review-notes");
    await page.locator(tid("tab-ext-review-assistant-review")).click();
    const body = page.locator(tid("ext-tab-content"));
    await expect(body).toBeVisible();
    await page.locator(tid("ext-action-run")).click();
    await expect(body).toContainText(/freshness/, { timeout: 30000 });
    await expect(body).toContainText(/2\/2/);
    await expect(body).not.toContainText("![pixel]");

    const section = body.locator(tid("ext-section")).filter({ hasText: "freshness" }).first();
    await expect(section.locator("button")).toHaveCount(4);
    await section.locator(tid("ext-action-defer")).click();
    await expect(section).toContainText(/defer/i);
    await expect(section).toContainText("rita");
    await logout(page);
  });

  test("viewer sees the findings but no buttons", async ({ page }) => {
    await page.goto("/artifacts/skill/rt-review-notes");
    await page.locator(tid("tab-ext-review-assistant-review")).click();
    const body = page.locator(tid("ext-tab-content"));
    await expect(body).toContainText(/freshness/);
    await expect(body.locator("button")).toHaveCount(0);
  });
});
