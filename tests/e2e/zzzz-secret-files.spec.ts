// E2E (publish-secret-files): the Publish page refuses a secret file before anything is sent — neither the dry run
// nor the publish request leaves the browser.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const md = "---\nname: pdf-web-env\ndescription: Counts pages of PDF files. Use when a PDF is too long to read.\n---\n\n# pdf-web-env\n\nRun it.\n";

test("a .env among the files: E_SECRET_FILE on the page, no request to the registry", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/v1\/artifacts/.test(r.url())) sent.push(r.url());
  });
  await page.goto("/");
  await loginAs(page, "alice");
  await page.goto("/publish");
  await page.locator(tid("publish-files-input")).setInputFiles([
    { name: "SKILL.md", mimeType: "text/markdown", buffer: Buffer.from(md) },
    { name: ".env", mimeType: "text/plain", buffer: Buffer.from("OPENAI_API_KEY=x\n") },
  ]);
  await expect(page.locator(tid("publish-errors"))).toContainText("E_SECRET_FILE");
  await expect(page.locator(tid("publish-errors"))).toContainText(".env");
  // The dry run would start within 400 ms of a change; give it time to (not) happen.
  await page.waitForTimeout(1200);
  expect(sent).toEqual([]);
  await logout(page);
});
