// Acceptance e2e: MCP shadow inventory UI.
// Data arrives through the agent snapshot API (as from `skillforge agent scan --mcp`); at the end the agent is deleted
// so as not to affect other specs.
import { test, expect, type Page } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const SKILL =
  "---\nname: mcp-notes\ndescription: Keeps short notes for the MCP inventory test. Use when the user asks to remember a note.\n---\n\n# Notes\n\nStore notes in `notes.md`.\n";

const obs = (o: Record<string, unknown>) => ({
  scope: "user",
  transport: "stdio",
  launcher: "npx",
  package: null,
  pinned: false,
  version: null,
  origin: null,
  env: [],
  headers: [],
  literal_secret: false,
  enabled: true,
  runtime: "claude-code",
  source: "~/.claude.json",
  ...o,
});

async function putSnapshot(page: Page, mcp?: unknown) {
  const r = await page.request.put("/api/v1/me/agents/mcp-laptop", {
    data: {
      runtime: "claude-code",
      files: [{ path: "skills/mcp-notes/SKILL.md", content_base64: Buffer.from(SKILL).toString("base64") }],
      ...(mcp ? { mcp } : {}),
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

test.describe("MCP servers on screens", () => {
  test("alice sees a hint, then her MCP servers; admin sees the server with a secret first", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await putSnapshot(page);
    await page.goto("/me/agents/mcp-laptop");
    await expect(page.locator(tid("agent-mcp-hint"))).toContainText("skillforge agent scan --name mcp-laptop --mcp");
    await expect(page.locator(tid("agent-mcp-server"))).toHaveCount(0);

    await putSnapshot(page, {
      sources: [{ runtime: "claude-code", scope: "user", path: "~/.claude.json", found: true }],
      servers: [
        obs({ name: "tickets", package: "tickets-mcp", env: [{ name: "TICKETS_API_KEY", kind: "literal", secret_like: true }], literal_secret: true }),
        obs({ name: "sentry", transport: "http", launcher: null, origin: "https://mcp.sentry.dev", headers: [{ name: "Authorization", kind: "reference", secret_like: true }] }),
      ],
      issues: [],
    });
    await page.reload();
    await expect(page.locator(tid("agent-mcp-hint"))).toHaveCount(0);
    await expect(page.locator(tid("agent-mcp-scanned"))).toBeVisible();
    await expect(page.locator(tid("agent-mcp-server"))).toHaveCount(2);
    const tickets = page.locator(`${tid("agent-mcp-server")}[data-name="tickets"]`);
    await expect(tickets).toHaveAttribute("data-literal", "1");
    await expect(tickets).toContainText("TICKETS_API_KEY");
    await expect(tickets).toContainText("tickets-mcp");
    const sentry = page.locator(`${tid("agent-mcp-server")}[data-name="sentry"]`);
    await expect(sentry).toHaveAttribute("data-literal", "0");
    await expect(sentry).toContainText("https://mcp.sentry.dev");
    await expect(sentry).not.toContainText("Authorization");
    await logout(page);

    await loginAs(page, "admin");
    await page.goto("/admin/inventory");
    await expect(page.locator(tid("inventory-mcp-totals"))).toBeVisible();
    const first = page.locator(tid("inventory-mcp-server")).first();
    await expect(first).toHaveAttribute("data-key", "package:npx:tickets-mcp");
    await expect(first).toHaveAttribute("data-literal", "1");
    await expect(first).toHaveAttribute("data-unpinned", "1");
    await expect(first).toContainText("alice");
    const remote = page.locator(`${tid("inventory-mcp-server")}[data-key="origin:https://mcp.sentry.dev"]`);
    await expect(remote).toHaveAttribute("data-literal", "0");
    await expect(page.locator(tid("inventory-mcp-empty"))).toHaveCount(0);
    await logout(page);

    await loginAs(page, "alice");
    const del = await page.request.delete("/api/v1/me/agents/mcp-laptop");
    expect(del.status()).toBe(204);
    await logout(page);
  });
});

// MCP server card: the MCP server card and the "In registry" column in the inventory.
test.describe("MCP server card", () => {
  test("alice publishes github-tools: the card shows the secret variable and the policy; admin sees the link in the inventory", async ({ page }) => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./state.ts");
    const dir = join(ROOT, "tests", "fixtures", "mcp-servers", "github-tools");
    const walk = (d: string, rel = ""): Array<{ path: string; content_base64: string }> =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        const r = rel ? `${rel}/${n}` : n;
        return statSync(p).isDirectory() ? walk(p, r) : [{ path: `github-tools/${r}`, content_base64: readFileSync(p).toString("base64") }];
      });
    await page.goto("/");
    await loginAs(page, "alice");
    const pub = await page.request.post("/api/v1/artifacts", { data: { type: "mcp-server", files: walk(dir) } });
    expect([201, 409], await pub.text()).toContain(pub.status());
    await page.goto("/artifacts/mcp-server/github-tools");
    const card = page.locator(tid("mcp-card"));
    await expect(card).toBeVisible();
    await expect(card.locator(`${tid("mcp-card-env")}[data-name="GITHUB_PERSONAL_ACCESS_TOKEN"]`)).toHaveAttribute("data-secret", "1");
    await expect(card.locator(tid("mcp-card-package"))).toContainText("@modelcontextprotocol/server-github@2025.4.8");
    await expect(card.locator(tid("mcp-card-policy"))).toHaveAttribute("data-allowed", "1");
    await expect(card.locator(tid("mcp-card-tool"))).toHaveCount(2);
    await expect(card).not.toContainText("github.com");

    await putSnapshot(page, {
      sources: [{ runtime: "claude-code", scope: "user", path: "~/.claude.json", found: true }],
      servers: [
        obs({ name: "github", package: "@modelcontextprotocol/server-github", pinned: true, version: "2025.4.8" }),
        obs({ name: "tickets", package: "tickets-mcp" }),
      ],
      issues: [],
    });
    await logout(page);
    await loginAs(page, "admin");
    await page.goto("/admin/inventory");
    const gh = page.locator(`${tid("inventory-mcp-server")}[data-key="package:npx:@modelcontextprotocol/server-github"]`);
    await expect(gh.locator(tid("inventory-mcp-registry"))).toContainText("github-tools");
    const tickets = page.locator(`${tid("inventory-mcp-server")}[data-key="package:npx:tickets-mcp"]`);
    await expect(tickets.locator(tid("inventory-mcp-registry"))).not.toContainText("github-tools");
    await expect(tickets.locator(`${tid("inventory-mcp-registry")} a`)).toHaveCount(0);
    await logout(page);

    await loginAs(page, "alice");
    expect((await page.request.delete("/api/v1/me/agents/mcp-laptop")).status()).toBe(204);
    await logout(page);
  });
});
