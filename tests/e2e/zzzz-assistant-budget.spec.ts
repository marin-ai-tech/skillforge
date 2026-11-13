// E2E (llm-budget-broker): the help assistant offers the Agent Space task budget grant field only when the server has
// a budget broker; the grant goes into the chat request and is never kept in the browser. The assistant status and
// the chat answer are stubbed with page.route, so the spec does not depend on the stand's LLM settings.
import { test, expect, type Page } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const GRANT = `as_sf_${"E".repeat(20)}2eGrantMark${"z".repeat(12)}`;

async function stubAssistant(page: Page, budgetGrant: boolean, bodies: unknown[]) {
  await page.route("**/api/v1/assistant/status", (route) =>
    route.fulfill({ json: { available: true, remaining_today: 10, ...(budgetGrant ? { budget_grant: true } : {}) } }),
  );
  await page.route("**/api/v1/assistant/chat", async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: 'event: delta\ndata: {"text":"Candidates wait for review."}\n\nevent: done\ndata: {"usage":{"input_tokens":1,"output_tokens":1}}\n\n',
    });
  });
}

test.describe.serial("assistant budget grant", () => {
  test("without a broker there is no grant field", async ({ page }) => {
    await stubAssistant(page, false, []);
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/help?assistant=consult");
    await expect(page.locator(tid("assistant-chat"))).toBeVisible();
    await expect(page.locator(tid("assistant-budget-grant"))).toHaveCount(0);
    await logout(page);
  });

  test("with a broker the grant is sent with the question and is not kept in the browser", async ({ page }) => {
    const bodies: Array<Record<string, unknown>> = [];
    await stubAssistant(page, true, bodies);
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/help?assistant=consult");
    const field = page.locator(tid("assistant-budget-grant"));
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute("type", "password");
    await field.fill(GRANT);
    await page.locator(tid("assistant-input")).fill("What is a candidate?");
    await page.locator(tid("assistant-send")).click();
    await expect(page.locator(`${tid("assistant-message")}[data-role="assistant"]`).last()).toContainText("Candidates wait");
    expect(bodies.at(-1)?.budget_grant).toBe(GRANT);

    await page.reload();
    await expect(page.locator(tid("assistant-budget-grant"))).toHaveValue("");
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain(GRANT);
    await logout(page);
  });
});
