// mcp-version-tracking, part W (web): source releases on the MCP server card, other versions,
// the Check now button (pending and error), and the inventory columns. The card API is faked
// with page.route like zzzz-security-clearance.spec.ts does for stale. Each run publishes its
// own artifact, so --repeat-each works.
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loginAs, logout } from "./auth-helpers.ts";
import { ROOT } from "./state.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

type OtherVersion = { version: string; installs: number };

function cardBody(overrides: Record<string, unknown> = {}) {
  return {
    version: "2025.4.8",
    packages: [
      {
        registryType: "npm",
        identifier: "@modelcontextprotocol/server-github",
        version: "2025.4.8",
        runtimeHint: "npx",
        transport: "stdio",
        env: [],
      },
    ],
    remotes: [],
    tools: [],
    policy: { allowed: true, reasons: [] },
    usage: { installs: 3, people: 1, same_version: 1, other_versions: [] as OtherVersion[] },
    release: null as Record<string, unknown> | null,
    ...overrides,
  };
}

function release(state: string, extra: Record<string, unknown> = {}) {
  return {
    registry_type: "npm",
    identifier: "@modelcontextprotocol/server-github",
    registry_version: "2025.4.8",
    upstream_version: "2025.5.0",
    state,
    state_detail: null as string | null,
    checked_at: "2026-11-24T09:00:00.000Z",
    ...extra,
  };
}

async function publishServer(page: Page, name: string): Promise<void> {
  const dir = join(ROOT, "tests", "fixtures", "mcp-servers", "github-tools");
  const md = readFileSync(join(dir, "MCP.md"), "utf8").replace(/^name: github-tools$/m, `name: ${name}`);
  const files = [
    { path: `${name}/MCP.md`, content_base64: Buffer.from(md).toString("base64") },
    {
      path: `${name}/server.json`,
      content_base64: readFileSync(join(dir, "server.json")).toString("base64"),
    },
  ];
  const r = await page.request.post("/api/v1/artifacts", { data: { type: "mcp-server", files } });
  expect(r.status(), await r.text()).toBe(201);
}

async function fakeCard(page: Page, name: string, body: ReturnType<typeof cardBody>): Promise<void> {
  const re = new RegExp(`/api/v1/artifacts/mcp-server/${name}/mcp(?:\\?|$)`);
  await page.route(re, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 200, json: body });
  });
}

test.describe("MCP version tracking on the card and inventory", () => {
  test("card states, other versions, pending and refused check, viewer has no button", async ({
    page,
  }, info) => {
    const name = `mcpver-b-${info.repeatEachIndex}-${Date.now() % 100000}`;
    await page.goto("/");
    await loginAs(page, "alice");
    await publishServer(page, name);

    await fakeCard(page, name, cardBody());
    await page.goto(`/artifacts/mcp-server/${name}`);
    const block = page.locator(tid("mcp-release"));
    await expect(block).toBeVisible();
    await expect(block).toHaveAttribute("data-state", "never");
    await expect(block).toContainText("Not checked yet");
    await expect(page.locator(tid("mcp-other-versions"))).toHaveCount(0);
    const check = page.locator(tid("mcp-release-check"));
    await expect(check).toBeVisible();
    await expect(check).toContainText("Check now");

    await fakeCard(
      page,
      name,
      cardBody({
        release: release("update_available"),
        usage: {
          installs: 3,
          people: 1,
          same_version: 1,
          other_versions: [
            { version: "1.6.3", installs: 2 },
            { version: "1.6.2", installs: 1 },
          ],
        },
      }),
    );
    await page.reload();
    await expect(block).toHaveAttribute("data-state", "update_available");
    const status = page.locator(tid("mcp-release-status"));
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toContainText("2025.5.0 is out at the source; the registry has 2025.4.8.");
    await expect(status).toContainText(
      "Review the package, then publish a new version of this artifact in the registry.",
    );
    await expect(status).toContainText("checked");
    await expect(status.locator("code").nth(0)).toHaveText("2025.5.0");
    await expect(status.locator("code").nth(1)).toHaveText("2025.4.8");
    await expect(page.locator(tid("mcp-release-update-help"))).toHaveText("How to update");
    await expect(page.locator(tid("mcp-other-versions"))).toHaveText(
      "Other versions in agent snapshots: 1.6.3 (2), 1.6.2 (1)",
    );

    await fakeCard(
      page,
      name,
      cardBody({
        release: release("failed", { upstream_version: null, state_detail: "http_503" }),
      }),
    );
    await page.reload();
    await expect(block).toHaveAttribute("data-state", "failed");
    await expect(block).toContainText("The check failed (http_503)");

    const checkPath = `**/api/v1/artifacts/mcp-server/${name}/mcp/release-check`;
    await page.route(checkPath, (route) =>
      route.fulfill({ status: 409, json: { error: "release_check_disabled" } }),
    );
    await check.click();
    const alert = page.locator(tid("mcp-release-error"));
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveText("Release checks are turned off on this server");
    await page.unroute(checkPath);

    let releaseHeld!: () => void;
    const held = new Promise<void>((r) => (releaseHeld = r));
    await page.route(checkPath, async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        json: { release: release("up_to_date", { upstream_version: "2025.4.8" }) },
      });
    });
    await check.click();
    await expect(check).toHaveAttribute("aria-busy", "true");
    await expect(check).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(tid("mcp-release-status"))).toHaveText("Checking\u2026");
    releaseHeld();
    await expect(check).not.toHaveAttribute("aria-busy", "true");
    await expect(block).toHaveAttribute("data-state", "up_to_date");
    const done = page.locator(tid("mcp-release-status"));
    await expect(done).toHaveAttribute("role", "status");
    await expect(done).toContainText("checked");
    await expect(done.locator("code").nth(0)).toHaveText("@modelcontextprotocol/server-github");
    await expect(done.locator("code").nth(1)).toHaveText("2025.4.8");
    await page.unroute(checkPath);

    await logout(page);
    await loginAs(page, "bob");
    await fakeCard(page, name, cardBody({ release: release("update_available") }));
    await page.goto(`/artifacts/mcp-server/${name}`);
    await expect(page.locator(tid("mcp-release"))).toBeVisible();
    await expect(page.locator(tid("mcp-release-check"))).toHaveCount(0);
    await logout(page);
  });

  test("inventory columns: registry version and different version", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await page.route("**/api/v1/admin/inventory", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const res = await route.fetch();
      const json = (await res.json()) as {
        mcp?: { totals?: Record<string, number>; servers?: unknown[] };
      };
      json.mcp = {
        totals: {
          agents: 1,
          people: 1,
          servers: 1,
          installs: 3,
          unpinned_installs: 0,
          literal_secret_installs: 0,
          remote_installs: 0,
          drift_installs: 2,
          ...(json.mcp?.totals ?? {}),
          servers: 1,
          drift_installs: 2,
        },
        servers: [
          {
            key: "package:npx:fake-mcp-ver",
            kind: "package",
            label: "fake-mcp-ver",
            names: ["fake-mcp-ver"],
            transports: ["stdio"],
            installs: 3,
            people: ["alice"],
            versions: ["1.6.3", "1.6.4"],
            unpinned_installs: 0,
            literal_secret_installs: 0,
            disabled_installs: 0,
            drift_installs: 2,
            registry: { name: "fake-mcp-ver", status: "active", version: "1.6.4" },
          },
        ],
      };
      await route.fulfill({ status: 200, json });
    });
    await page.goto("/admin/inventory");
    const table = page.locator(tid("inventory-mcp"));
    await expect(table).toBeVisible();
    await expect(table.locator("th")).toContainText(["Version in the registry", "Different version"]);
    const row = page.locator(tid("inventory-mcp-server")).first();
    await expect(row.locator(tid("inventory-mcp-registry-version"))).toHaveText("1.6.4");
    const drift = row.locator(tid("inventory-mcp-drift"));
    await expect(drift).toHaveText("2");
    await expect(drift).toHaveClass(/text-warning/);
    const totals = page.locator(tid("inventory-mcp-totals"));
    await expect(totals).toContainText("Different version");
    const driftTotal = page.locator(tid("inventory-mcp-totals-drift"));
    await expect(driftTotal).toHaveText("2");
    await expect(driftTotal).toHaveClass(/text-warning/);
    await logout(page);
  });

  test("remote-only has no check button; oci-only is unsupported without a check", async ({
    page,
  }, info) => {
    const name = `mcpver-c-remote-${info.repeatEachIndex}-${Date.now() % 100000}`;
    await page.goto("/");
    await loginAs(page, "alice");
    await publishServer(page, name);

    await fakeCard(
      page,
      name,
      cardBody({
        packages: [],
        remotes: [
          {
            type: "streamable-http",
            url: "https://mcp.example.com/sse",
            origin: "https://mcp.example.com",
            headers: [],
          },
        ],
      }),
    );
    await page.goto(`/artifacts/mcp-server/${name}`);
    const block = page.locator(tid("mcp-release"));
    await expect(block).toBeVisible();
    await expect(block).toHaveAttribute("data-state", "remote_only");
    await expect(page.locator(tid("mcp-release-status"))).toHaveText(
      "Release checks are not available for remote-only servers",
    );
    await expect(page.locator(tid("mcp-release-check"))).toHaveCount(0);

    await fakeCard(
      page,
      name,
      cardBody({
        packages: [
          {
            registryType: "oci",
            identifier: "ghcr.io/example/mcp",
            version: "1.0.0",
            runtimeHint: null,
            transport: "stdio",
            env: [],
          },
        ],
        remotes: [],
        release: null,
      }),
    );
    await page.reload();
    await expect(block).toHaveAttribute("data-state", "unsupported");
    await expect(page.locator(tid("mcp-release-status"))).toHaveText(
      "Release checks are not available for container images",
    );
    await expect(page.locator(tid("mcp-release-check"))).toHaveCount(0);
    await logout(page);
  });

  test("card query loading, error and retry", async ({ page }, info) => {
    const name = `mcpver-c-load-${info.repeatEachIndex}-${Date.now() % 100000}`;
    await page.goto("/");
    await loginAs(page, "alice");
    await publishServer(page, name);

    const re = new RegExp(`/api/v1/artifacts/mcp-server/${name}/mcp(?:\\?|$)`);
    let releaseHeld!: () => void;
    const held = new Promise<void>((r) => (releaseHeld = r));
    await page.route(re, async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await held;
      await route.fulfill({ status: 500, json: { error: "request_failed" } });
    });
    await page.goto(`/artifacts/mcp-server/${name}`);
    const section = page.locator(tid("mcp-card"));
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute("aria-busy", "true");
    await expect(section).toContainText("Loading");
    releaseHeld();
    const alert = page.locator(tid("mcp-card-error"));
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveText("The request failed.");
    await expect(section).not.toHaveAttribute("aria-busy", "true");
    const retry = page.locator(tid("mcp-card-retry"));
    await expect(retry).toHaveText("Retry");
    await page.unroute(re);
    await fakeCard(page, name, cardBody());
    await retry.click();
    await expect(page.locator(tid("mcp-release"))).toBeVisible();
    await expect(page.locator(tid("mcp-release"))).toHaveAttribute("data-state", "never");
    await logout(page);
  });
});
