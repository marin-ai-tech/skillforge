// Acceptance e2e for the `settings` type in the catalog, the profile card (settings.json, scope, CLI command on Install).
// The name `zz-…` means it publishes its own artifact after the other specs.
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loginAs, logout } from "./auth-helpers.ts";
import { ROOT } from "./state.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const PROFILE = join(ROOT, "tests", "fixtures", "settings", "team-baseline");

function profileFiles() {
  const out: { path: string; content_base64: string }[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: `team-baseline/${relative(PROFILE, p).replace(/\\/g, "/")}`, content_base64: readFileSync(p).toString("base64") });
    }
  };
  walk(PROFILE);
  return out;
}

test.describe("the settings profile in the UI", () => {
  test("catalog, card and apply command", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    const pub = await page.request.post("/api/v1/artifacts", { data: { files: profileFiles() } });
    expect(pub.status(), await pub.text()).toBe(201);

    await page.goto("/artifacts");
    const tab = page.locator(tid("browse-tab-settings"));
    await expect(tab).toContainText("Settings profiles");
    await tab.click();
    await expect(page.locator(`${tid("artifact-card")}[data-name="team-baseline"]`)).toHaveAttribute("data-type", "settings");

    await page.goto("/artifacts/settings/team-baseline");
    await expect(page.locator(tid("settings-json"))).toContainText("permissions");
    await expect(page.locator(tid("settings-scope"))).toContainText("project");
    await page.locator(tid("tab-install")).click();
    await expect(page.locator(tid("install-settings-cli"))).toContainText("skillforge settings apply settings/team-baseline --scope project");
    await expect(page.locator(tid("install-plugin-cmd"))).toHaveCount(0);
    await expect(page.locator(tid("install-download-tgz"))).toHaveCount(0);

    await page.goto("/publish");
    await expect(page.locator(`${tid("publish-type")} option[value="settings"]`)).toHaveCount(1);
    await logout(page);
  });
});
