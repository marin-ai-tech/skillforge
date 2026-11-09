// Acceptance e2e for the artifact page layout:
// Overview — blocks span the full page width; Files — markdown is rendered (frontmatter as a table, Source toggle),
// non-md files as code, a `javascript:` link from an untrusted file does not work.
import { test, expect, type Page } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const PROBE = "md-render-probe";
const PROBE_MD = [
  "---",
  `name: ${PROBE}`,
  "description: Probe skill for markdown rendering on the Files tab.",
  "---",
  "",
  "# Probe heading",
  "",
  "Text with **bold** and a [bad link](javascript:alert(1)).",
  "",
].join("\n");

async function width(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((e) => e.getBoundingClientRect().width);
}

test.describe("artifact page", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/");
    await loginAs(page, "admin");
    const exists = await page.request.get(`/api/v1/artifacts/skill/${PROBE}`);
    if (exists.status() === 404) {
      const pub = await page.request.post("/api/v1/artifacts", {
        data: { type: "skill", files: [{ path: `${PROBE}/SKILL.md`, content_base64: Buffer.from(PROBE_MD).toString("base64") }] },
      });
      expect(pub.status(), await pub.text()).toBe(201);
    }
    await logout(page);
    await page.close();
  });

  test("Overview: the main file and metadata span the full width, metadata below", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/artifacts/skill/pdf-tools");
    await expect(page.locator(tid("overview-markdown"))).toBeVisible();
    const header = await width(page, `header:has(${tid("detail-name")})`);
    const md = await width(page, tid("overview-markdown"));
    const meta = await width(page, tid("overview-meta"));
    expect(Math.abs(md - header), `markdown ${md} vs header ${header}`).toBeLessThanOrEqual(2);
    expect(Math.abs(meta - header), `meta ${meta} vs header ${header}`).toBeLessThanOrEqual(2);
    const mdBox = await page.locator(tid("overview-markdown")).boundingBox();
    const metaBox = await page.locator(tid("overview-meta")).boundingBox();
    expect(metaBox!.y).toBeGreaterThan(mdBox!.y + mdBox!.height - 1);
  });

  test("Files: SKILL.md is rendered, frontmatter as a table, Source shows the source", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools?tab=files&file=skills/pdf-tools/SKILL.md");
    const viewer = page.locator(tid("file-viewer"));
    await expect(viewer.getByRole("heading", { name: "PDF tools" })).toBeVisible();
    await expect(viewer).not.toContainText("# PDF tools");
    await expect(viewer).not.toContainText("name: pdf-tools");
    const fm = page.locator(tid("file-frontmatter"));
    await expect(fm).toContainText("name");
    await expect(fm).toContainText("pdf-tools");
    await page.locator(tid("file-view-mode")).getByRole("button", { name: "Source" }).click();
    await expect(viewer).toContainText("name: pdf-tools");
    await expect(viewer).toContainText("# PDF tools");
    await expect(page).toHaveURL(/view=source/);
    await page.locator(tid("file-view-mode")).getByRole("button", { name: "Rendered" }).click();
    await expect(viewer.getByRole("heading", { name: "PDF tools" })).toBeVisible();
  });

  test("Files: non-markdown is shown as code, without a toggle", async ({ page }) => {
    await page.goto("/artifacts/hook/destructive-guard?tab=files&file=hooks/hooks.json");
    await expect(page.locator(tid("file-viewer"))).toContainText('"hooks"');
    await expect(page.locator(tid("file-view-mode"))).toHaveCount(0);
  });

  test("Files: a javascript: link from a file is not executed, markup is rendered", async ({ page }) => {
    let dialog = false;
    page.on("dialog", async (d) => {
      dialog = true;
      await d.dismiss();
    });
    await page.goto(`/artifacts/skill/${PROBE}?tab=files&file=skills/${PROBE}/SKILL.md`);
    const viewer = page.locator(tid("file-viewer"));
    await expect(viewer.getByRole("heading", { name: "Probe heading" })).toBeVisible();
    await expect(viewer.locator("strong")).toHaveText("bold");
    const link = viewer.getByText("bad link");
    await expect(link).toBeVisible();
    const href = await link.evaluate((e) => e.closest("a")?.getAttribute("href") ?? "");
    expect(href.toLowerCase()).not.toContain("javascript:");
    await link.click({ force: true });
    expect(dialog).toBe(false);
  });
});
