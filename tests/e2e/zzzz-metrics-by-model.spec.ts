// E2E (session-fact-model): the metrics tab shows a "By model" table under "By agent". A model two people reported is
// named; a model one person reported joins "Other or not reported" and its name is not on the page. Without models
// there is no table.
import { test, expect, type Page } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const NAME = "e2e-by-model";
const PLAIN = "e2e-by-model-plain";
let n = 0;
const fact = (skill: string, verification: string, model?: string) => ({
  skill,
  session_key: (0xb0de00 + ++n).toString(16).padStart(32, "0"),
  used_at: new Date(Date.now() - n * 60_000).toISOString(),
  verification,
  ...(model ? { model } : {}),
});

async function publish(page: Page, name: string) {
  const md = `---\nname: ${name}\ndescription: Skill for the by-model table e2e check on the metrics tab.\n---\n\n# ${name}\n\nDo the task.\n`;
  const r = await page.request.post("/api/v1/artifacts", {
    data: { type: "skill", files: [{ path: `${name}/SKILL.md`, content_base64: Buffer.from(md).toString("base64") }] },
  });
  expect(r.status(), await r.text()).toBe(201);
}

async function send(page: Page, facts: object[]) {
  const r = await page.request.post("/api/v1/me/session-facts", { data: { source: "claude-code", facts } });
  expect((await r.json()).accepted).toBe(facts.length);
}

test("the By model table: a model two people reported, other models hidden, no table without models", async ({ page }) => {
  await page.goto("/");
  await loginAs(page, "alice");
  await publish(page, NAME);
  await publish(page, PLAIN);
  await send(page, [fact(NAME, "pass", "claude-opus-5-5"), fact(NAME, "pass", "e2e-solo-model"), fact(PLAIN, "pass")]);
  await logout(page);
  await loginAs(page, "rita");
  await send(page, [fact(NAME, "pass", "claude-opus-5-5")]);

  await page.goto(`/artifacts/skill/${NAME}?tab=metrics`);
  const table = page.getByRole("table", { name: "By model" });
  await expect(table).toBeVisible();
  const opus = table.locator('[data-runtime="claude-code"][data-model="claude-opus-5-5"]');
  await expect(opus).toContainText("Claude Code");
  await expect(opus).toContainText("claude-opus-5-5");
  await expect(opus).toContainText("100%");
  const other = table.locator('[data-runtime="claude-code"][data-model=""]');
  await expect(other).toContainText("Other or not reported");
  await expect(other).toContainText("Hidden: one user");
  await expect(page.locator("body")).not.toContainText("e2e-solo-model");

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(table).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto(`/artifacts/skill/${PLAIN}?tab=metrics`);
  await expect(page.locator(tid("metrics-by-runtime"))).toBeVisible();
  await expect(page.locator(tid("metrics-by-model"))).toHaveCount(0);
  await logout(page);
});
