// E2E: admin configures the LLM in the interface, a
// signed-in user talks to the help assistant in the "Onboarding" and "Consultation" modes in the interface language;
// an anonymous visitor sees an invitation to sign in; answer links point only inside the help. The model is the stub
// from global-setup.
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { STATE_FILE } from "./state.ts";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const llmUrl = () => (JSON.parse(readFileSync(STATE_FILE, "utf8")) as { llmUrl: string }).llmUrl;

async function configure(page: Page, enabled: boolean) {
  await page.goto("/");
  await loginAs(page, "admin");
  await page.goto("/admin/assistant");
  await expect(page.locator(tid("llm-key-status"))).toContainText("SKILLFORGE_LLM_API_KEY");
  await page.locator(tid("llm-base-url")).fill(llmUrl());
  await page.locator(tid("llm-model")).fill("test-model");
  await page.locator(tid("llm-enabled")).setChecked(enabled);
  await page.locator(tid("llm-save")).click();
  await expect(page.locator(tid("llm-notice"))).toBeVisible();
  await logout(page);
}

test.describe.serial("help assistant", () => {
  test("off by default: no \"Assistant\" tab", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/help");
    await expect(page.locator(tid("help-search"))).toBeVisible();
    await expect(page.locator(tid("help-assistant-tab"))).toHaveCount(0);
    await logout(page);
  });

  test("admin: the key is shown only as \"set\", settings are saved, the connection test passes", async ({ page }) => {
    await configure(page, true);
    await page.goto("/");
    await loginAs(page, "admin");
    await page.goto("/admin/assistant");
    await expect(page.locator(tid("llm-key-status"))).not.toContainText("sk-e2e-llm-key");
    await expect(page.locator(tid("llm-base-url"))).toHaveValue(llmUrl());
    await page.locator(tid("llm-test")).click();
    await expect(page.locator(tid("llm-test-result"))).toContainText("test-model");
    await logout(page);
  });

  test("onboarding in English: the assistant starts the conversation, links only inside the help", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/help");
    // The assistant tab opens onboarding, which starts the conversation by itself: listen before the click.
    const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().includes("/api/v1/assistant/chat"));
    await page.locator(tid("help-assistant-tab")).click();
    await expect(page.locator(tid("assistant-chat"))).toBeVisible();
    await page.locator(tid("assistant-mode-onboarding")).click();
    expect(JSON.parse((await sent).postData() ?? "{}")).toMatchObject({ mode: "onboarding", lang: "en" });
    const answer = page.locator(`${tid("assistant-message")}[data-role="assistant"]`).first();
    await expect(answer).toContainText("Statuses are described", { timeout: 15000 });
    await expect(answer.locator('a[href="/help/getting-started/lifecycle"]')).toBeVisible();
    await expect(answer.locator('a[href^="http"]')).toHaveCount(0);
    await expect(answer).toContainText("example.com");
    await logout(page);
  });

  test("consultation: the user's question and a streamed answer; \"New conversation\" clears the history", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "bob");
    await page.goto("/help?assistant=consult");
    await expect(page.locator(tid("assistant-chat"))).toBeVisible();
    await page.locator(tid("assistant-input")).fill("What do lifecycle statuses mean?");
    await page.locator(tid("assistant-send")).click();
    await expect(page.locator(`${tid("assistant-message")}[data-role="user"]`)).toContainText("lifecycle statuses");
    await expect(page.locator(`${tid("assistant-message")}[data-role="assistant"]`).last()).toContainText(
      "Statuses are described",
    );
    await page.locator(tid("assistant-new")).click();
    await expect(page.locator(tid("assistant-message"))).toHaveCount(0);
    await logout(page);
  });

  test("the side panel leads to the assistant; an anonymous visitor sees an invitation to sign in", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.locator(tid("help-button")).first().click();
    await page.locator(tid("help-ask-assistant")).click();
    await expect(page).toHaveURL(/\/help\?assistant=consult/);
    await expect(page.locator(tid("assistant-chat"))).toBeVisible();
    await logout(page);
    await page.goto("/help?assistant=consult");
    await expect(page.locator(tid("assistant-sign-in"))).toBeVisible();
    await expect(page.locator(tid("assistant-input"))).toHaveCount(0);
  });

  test("turning it off brings back the help without the tab", async ({ page }) => {
    await configure(page, false);
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/help");
    await expect(page.locator(tid("help-search"))).toBeVisible();
    await expect(page.locator(tid("help-assistant-tab"))).toHaveCount(0);
    await logout(page);
  });
});
