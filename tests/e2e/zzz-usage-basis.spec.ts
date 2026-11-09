// The Evidence tab shows assigned reports on a separate row and does not include them in Transfer Rate;
// metrics show sessions with preloaded skills.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const NAME = "e2e-usage-basis";
const skillMd = `---\nname: ${NAME}\ndescription: Skill for the usage basis e2e check on the Evidence and Metrics tabs.\n---\n\n# Basis\n\nDo the task.\n`;

test("Evidence: assigned row without a share; metrics: sessions with preloaded skills", async ({ page }) => {
  await page.goto("/");
  await loginAs(page, "alice");
  const pub = await page.request.post("/api/v1/artifacts", {
    data: { type: "skill", files: [{ path: `${NAME}/SKILL.md`, content_base64: Buffer.from(skillMd).toString("base64") }] },
  });
  expect(pub.status(), await pub.text()).toBe(201);
  await logout(page);

  await loginAs(page, "rita");
  const tr = await page.request.post(`/api/v1/artifacts/skill/${NAME}/transitions`, { data: { to: "active" } });
  expect(tr.status(), await tr.text()).toBe(200);
  const report = (data: object) => page.request.post(`/api/v1/artifacts/skill/${NAME}/usage`, { data });
  expect((await report({ uses: 10, helped: 5 })).status()).toBe(201);
  expect((await report({ uses: 9, helped: 9, basis: "assigned" })).status()).toBe(201);
  const facts = await page.request.post("/api/v1/me/session-facts", {
    data: {
      source: "e2e",
      facts: [{ skill: NAME, session_key: "b".repeat(32), used_at: new Date().toISOString(), verification: "none", basis: "preloaded" }],
    },
  });
  expect((await facts.json()).accepted).toBe(1);

  await page.goto(`/artifacts/skill/${NAME}?tab=evidence`);
  const table = page.locator(tid("usage-by-source"));
  const assigned = table.locator('[data-source="api"][data-basis="assigned"]');
  await expect(assigned).toContainText("9");
  await expect(assigned).toContainText("—");
  await expect(page.locator(tid("usage-uses"))).toHaveText("10");
  await expect(page.locator(tid("transfer-rate"))).toHaveText("50%");
  await expect(table.locator('[data-source="api"][data-basis=""]')).toContainText("50%");

  await page.goto(`/artifacts/skill/${NAME}?tab=metrics`);
  await expect(page.locator(tid("metrics-preloaded"))).toHaveText("1");
});
