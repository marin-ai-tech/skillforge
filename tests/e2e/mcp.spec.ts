// E2E: MCP tokens on `/me/tokens`. Created tokens are revoked at the end —
// other specs (users, me) see alice's tokens.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("MCP tokens", () => {
  test("alice creates an agent token with tags and a regular token; connection snippets and chips", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/me/tokens");
    await expect(page.locator(tid("token-mcp-tags"))).toBeDisabled();

    await page.locator(tid("token-name")).fill("agent-e2e");
    await page.locator(tid("token-mcp")).check();
    await expect(page.locator(tid("token-mcp-tags"))).toBeEnabled();
    await page.locator(tid("token-mcp-tags")).fill("team-a, docs");
    await page.locator(tid("token-create-submit")).click();
    const secret = page.locator(tid("token-secret"));
    await expect(secret).toContainText("sf_");
    const snippet = page.locator(tid("token-mcp-snippet"));
    await expect(snippet).toContainText("/mcp");
    await expect(snippet).toContainText("claude mcp add --transport http skillforge");
    await expect(snippet).toContainText("claude mcp add skillforge -- skillforge mcp");
    const agentRow = page.locator(tid("token-row")).filter({ hasText: "agent-e2e" });
    await expect(agentRow.locator(tid("token-mcp-chip"))).toHaveText("MCP: team-a, docs");

    const api = await page.request.get("/api/v1/me/tokens");
    const items = ((await api.json()) as { items: { name: string; mcp: boolean; mcp_tags: string[] }[] }).items;
    const created = items.find((t) => t.name === "agent-e2e");
    expect(created?.mcp).toBe(true);
    expect(created?.mcp_tags).toEqual(["team-a", "docs"]);

    await page.reload();
    await page.locator(tid("token-name")).fill("plain-e2e");
    await page.locator(tid("token-create-submit")).click();
    await expect(page.locator(tid("token-secret"))).toContainText("sf_");
    await expect(page.locator(tid("token-mcp-snippet"))).toHaveCount(0);
    const plainRow = page.locator(tid("token-row")).filter({ hasText: "plain-e2e" });
    await expect(plainRow).toHaveCount(1);
    await expect(plainRow.locator(tid("token-mcp-chip"))).toHaveCount(0);

    for (const name of ["agent-e2e", "plain-e2e"]) {
      await page.locator(tid("token-row")).filter({ hasText: name }).locator(tid("token-revoke")).click();
      await page.locator(tid("dialog-confirm")).click();
      await expect(page.locator(tid("token-row")).filter({ hasText: name })).toHaveCount(0);
    }
    await logout(page);
  });

  // The client switcher changes the connection commands.
  test("connection commands for Codex, Cursor, OpenCode and Qwen Code", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/me/tokens");
    await page.locator(tid("token-name")).fill("clients-e2e");
    await page.locator(tid("token-mcp")).check();
    await page.locator(tid("token-create-submit")).click();
    await expect(page.locator(tid("token-secret"))).toContainText("sf_");
    const snippet = page.locator(tid("token-mcp-snippet"));
    const client = (id: string) => page.locator(`${tid("token-mcp-client")}[data-client="${id}"]`);
    await expect(snippet).toContainText("claude mcp add skillforge -- skillforge mcp");

    await client("opencode").click();
    await expect(snippet).toContainText("opencode mcp add skillforge --url");
    await expect(snippet).toContainText('--header "Authorization=Bearer sf_');
    await expect(snippet).not.toContainText("claude mcp add");

    await client("codex").click();
    await expect(snippet).toContainText("--bearer-token-env-var SKILLFORGE_TOKEN");
    await expect(snippet).toContainText("codex mcp add skillforge --env SKILLFORGE_URL=");
    await expect(snippet).not.toContainText("Bearer sf_");
    await expect(snippet).not.toContainText("claude mcp add");

    await client("qwen").click();
    await expect(snippet).toContainText("qwen mcp add -s user -t http");
    await expect(snippet).toContainText("qwen mcp add -s user skillforge skillforge mcp");

    await client("cursor").click();
    await expect(snippet).toContainText('"mcpServers"');
    await expect(snippet).toContainText(".cursor/mcp.json");
    await expect(snippet).not.toContainText("claude mcp add");

    await client("claude-code").click();
    await expect(snippet).toContainText("claude mcp add skillforge -- skillforge mcp");

    await page.locator(tid("token-row")).filter({ hasText: "clients-e2e" }).locator(tid("token-revoke")).click();
    await page.locator(tid("dialog-confirm")).click();
    await expect(page.locator(tid("token-row")).filter({ hasText: "clients-e2e" })).toHaveCount(0);
    await logout(page);
  });
});
