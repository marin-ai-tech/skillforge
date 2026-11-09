// Acceptance e2e: the owner adds an evidence document from a file,
// the row shows the document name as a link to its text; a file over 64 KiB is rejected by the form without a request.
import { test, expect } from "@playwright/test";
import { loginAs } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const NAME = "e2e-evidence-documents";
const skillMd = `---\nname: ${NAME}\ndescription: Skill for the evidence document e2e check on the Evidence tab.\n---\n\n# Docs\n\nDo the task.\n`;
const TEXT = "# Verification\n\nall checks green\n";

test.describe.serial("evidence document", () => {
  test("document from a file: row with the name, link to the text", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    const pub = await page.request.post("/api/v1/artifacts", {
      data: { type: "skill", files: [{ path: `${NAME}/SKILL.md`, content_base64: Buffer.from(skillMd).toString("base64") }] },
    });
    expect(pub.status(), await pub.text()).toBe(201);

    await page.goto(`/artifacts/skill/${NAME}?tab=evidence`);
    await page.locator(tid("evidence-kind")).selectOption("gate");
    await page.locator(tid("evidence-file")).setInputFiles({
      name: "verification.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(TEXT),
    });
    await page.locator(tid("evidence-add")).click();

    const row = page.locator(tid("evidence-row")).filter({ hasText: "verification.md" });
    await expect(row).toBeVisible();
    const href = await row.locator("a", { hasText: "verification.md" }).getAttribute("href");
    expect(href).toMatch(new RegExp(`^/api/v1/artifacts/skill/${NAME}/versions/0\\.1\\.0/evidence/documents/[0-9a-f]{64}$`));
    const doc = await page.request.get(href!);
    expect(doc.status()).toBe(200);
    expect(await doc.text()).toBe(TEXT);
  });

  test("file over 64 KiB is rejected by the form without a request", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto(`/artifacts/skill/${NAME}?tab=evidence`);
    // The record from the previous test: wait for the list before counting (the tab loads asynchronously).
    await expect(page.locator(tid("evidence-row"))).toHaveCount(1);
    const rows = 1;
    let posted = false;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/evidence")) posted = true;
    });
    await page.locator(tid("evidence-file")).setInputFiles({
      name: "big.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("x".repeat(65537)),
    });
    await page.locator(tid("evidence-add")).click();
    await expect(page.locator(tid("evidence-error"))).toBeVisible();
    expect(posted).toBe(false);
    await expect(page.locator(tid("evidence-row"))).toHaveCount(rows);
  });
});
