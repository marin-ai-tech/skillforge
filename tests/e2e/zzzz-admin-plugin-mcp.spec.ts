// fix-admin-plugin-mcp-tools: /admin/plugins names the MCP tools of a loaded plugin with their audience, marks a
// plugin that will add MCP tools once enabled, and after disabling says the MCP tools are already off. Negative case:
// a plugin without the mcp capability (hello) shows neither.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test("plugin MCP tools on the admin page", async ({ page }) => {
  await page.goto("/");
  await loginAs(page, "admin");
  await page.goto("/admin/plugins");
  const probe = page.locator(tid("plugin-row")).filter({ hasText: "mcp-probe" });
  await expect(probe.locator(tid("plugin-status"))).toHaveText("loaded");
  const tools = probe.locator(`${tid("plugin-mcp-tools")} ${tid("plugin-mcp-tool")}`);
  await expect(tools).toHaveCount(4);
  await expect(probe.locator(`${tid("plugin-mcp-tool")}[data-audience="integration"]`)).toContainText("probe_report");
  await expect(probe.locator(`${tid("plugin-mcp-tool")}[data-audience="agent"]`)).toHaveCount(3);

  const sdlc = page.locator(tid("plugin-row")).filter({ hasText: "sdlc-registry" });
  await expect(sdlc.locator(tid("plugin-status"))).toHaveText("disabled");
  await expect(sdlc.locator(tid("plugin-mcp-capability"))).toBeVisible();
  await expect(sdlc.locator(tid("plugin-mcp-tools"))).toHaveCount(0);

  const hello = page.locator(tid("plugin-row")).filter({ hasText: "hello" });
  await expect(hello.locator(tid("plugin-mcp-tools"))).toHaveCount(0);
  await expect(hello.locator(tid("plugin-mcp-capability"))).toHaveCount(0);

  await probe.locator(tid("plugin-toggle")).click();
  await expect(probe.locator(tid("plugin-restart-required"))).toContainText("MCP");
  await probe.locator(tid("plugin-toggle")).click();
  await expect(probe.locator(tid("plugin-toggle"))).toBeChecked();
  await logout(page);
});
