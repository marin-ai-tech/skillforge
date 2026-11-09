// E2E: the registry serves the CLI, the home page shows the CLI install command
// when the package exists (global-setup puts a stub into SKILLFORGE_DOWNLOADS_DIR); foreign names return 404.
import { test, expect } from "@playwright/test";
import { BASE } from "./state.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test("home: CLI install command from the registry", async ({ page }) => {
  await page.goto("/");
  const cli = page.locator(tid("home-install-cli"));
  await expect(cli).toContainText(`npm i -g ${BASE}/downloads/skillforge-cli.tgz`);
  const info = await (await page.request.get("/api/v1/install-info")).json();
  expect(info.cli.url).toBe(`${BASE}/downloads/skillforge-cli.tgz`);
  expect((await page.request.get("/downloads/skillforge-cli.tgz")).status()).toBe(200);
  expect((await page.request.get("/downloads/other.tgz")).status()).toBe(404);
});
