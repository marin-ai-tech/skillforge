// Acceptance e2e for the `plugin` type in the
// catalog, on the card and on the publish page.
// The name `zz-…` sorts after zz-agents: publishing a plugin must not affect the counters of the earlier specs.
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loginAs, logout } from "./auth-helpers.ts";
import { ROOT } from "./state.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const KIT = join(ROOT, "tests", "fixtures", "cc-plugins", "team-kit");

function kitFiles() {
  const out: { path: string; content_base64: string }[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: `team-kit/${relative(KIT, p).replace(/\\/g, "/")}`, content_base64: readFileSync(p).toString("base64") });
    }
  };
  walk(KIT);
  return out;
}

test.describe("the plugin type in the UI", () => {
  test("catalog, card with components and type selection on publish", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    const pub = await page.request.post("/api/v1/artifacts", { data: { files: kitFiles() } });
    expect(pub.status(), await pub.text()).toBe(201);

    await page.goto("/artifacts");
    const tab = page.locator(tid("browse-tab-plugin"));
    await expect(tab).toContainText("Plugins");
    await expect(tab).not.toContainText("Claude Code");
    await tab.click();
    const card = page.locator(`${tid("artifact-card")}[data-name="team-kit"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("data-type", "plugin");
    await card.locator("a").first().click();
    await expect(page).toHaveURL(/\/artifacts\/plugin\/team-kit/);

    const components = page.locator(`${tid("plugin-components")} ${tid("plugin-component")}`);
    await expect(components).toHaveCount(6);
    await expect(page.locator(`${tid("plugin-component")}[data-type="skill"]`)).toHaveCount(2);
    await expect(page.locator(`${tid("plugin-component")}[data-type="mcp_server"]`)).toContainText("release-db");
    // A candidate is not included in marketplace.json — the status rule for a plugin is the same as for the other types.
    await page.locator(tid("tab-install")).click();
    await expect(page.locator(tid("install-not-active"))).toBeVisible();
    await expect(page.locator(tid("install-plugin-cmd"))).toHaveCount(0);
    await expect(page.locator(tid("install-download-tgz"))).toHaveAttribute("href", /\/api\/v1\/plugins\/plugin\/team-kit\/[^/]+\.tar\.gz$/);
    const act = await page.request.post("/api/v1/artifacts/plugin/team-kit/transitions", { data: { to: "active", reason: "e2e" } });
    expect(act.status(), await act.text()).toBe(200);
    await page.goto("/artifacts/plugin/team-kit?tab=install");
    await expect(page.locator(tid("install-plugin-cmd"))).toContainText("/plugin install team-kit@");
    await expect(page.locator(tid("install-download-zip"))).toHaveAttribute("href", /bundle\.zip$/);

    await page.goto("/publish");
    await expect(page.locator(`${tid("publish-type")} option[value="plugin"]`)).toHaveCount(1);
    await logout(page);
  });
});
