// Acceptance e2e: the Evidence tab shows usage by source — reports via REST (`api`) and agent self-reports via MCP (`mcp`) as separate rows.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const NAME = "e2e-usage-sources";
const skillMd = `---\nname: ${NAME}\ndescription: Skill for the usage-by-source e2e check on the Evidence tab.\n---\n\n# Sources\n\nDo the task.\n`;

test("Evidence: usage by source", async ({ page }) => {
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
  const rep = await page.request.post(`/api/v1/artifacts/skill/${NAME}/usage`, { data: { uses: 10, helped: 4 } });
  expect(rep.status(), await rep.text()).toBe(201);
  const tok = await page.request.post("/api/v1/me/tokens", { data: { name: "e2e-agent", mcp: true } });
  expect(tok.status()).toBe(201);
  const token = (await tok.json()).token as string;
  for (let i = 0; i < 2; i++) {
    const r = await page.request.post("/mcp", {
      headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" },
      data: {
        jsonrpc: "2.0",
        id: i + 1,
        method: "tools/call",
        params: { name: "record_usage", arguments: { type: "skill", name: NAME, uses: 3, helped: 3 } },
      },
    });
    expect(r.status()).toBe(200);
  }

  await page.goto(`/artifacts/skill/${NAME}?tab=evidence`);
  const table = page.locator(tid("usage-by-source"));
  await expect(table).toBeVisible();
  const api = table.locator('[data-source="api"]');
  const mcp = table.locator('[data-source="mcp"]');
  await expect(api).toContainText("10");
  await expect(api).toContainText("40%");
  await expect(mcp).toContainText("6");
  await expect(mcp).toContainText("100%");
  await expect(table.locator('[data-source="hook"]')).toHaveCount(0);
});
