// file-tree-large: the Files tab of an artifact with thousands of files stays usable. Folders below the artifact root
// are collapsed (the path to the selected file is open), a filter finds a file by part of its path, and directory
// buttons carry aria-expanded. A small artifact keeps the old fully expanded tree.
import { test, expect, type Page } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const NAME = "big-tree-probe";
const ROOT = `skills/${NAME}`;
const dir = (p: string) => `${tid("file-dir")}[data-path="${ROOT}/${p}"]`;
const entry = (p: string) => `${tid("file-entry")}[data-path="${ROOT}/${p}"]`;

/** 30 folders × 10 subfolders × 10 files = 3000 files plus SKILL.md. */
function files(): Array<{ path: string; content_base64: string }> {
  const md = `---\nname: ${NAME}\ndescription: Probe skill with thousands of files for the Files tab. Use when testing the tree.\n---\n\n# Big tree\n`;
  const out = [{ path: `${NAME}/SKILL.md`, content_base64: Buffer.from(md).toString("base64") }];
  for (let a = 0; a < 30; a++) {
    for (let b = 0; b < 10; b++) {
      for (let f = 0; f < 10; f++) {
        const p = `docs/a${String(a).padStart(2, "0")}/b${b}/file-${f}.md`;
        out.push({ path: `${NAME}/${p}`, content_base64: Buffer.from(`# ${p}\n`).toString("base64") });
      }
    }
  }
  return out;
}

const filesTab = (page: Page, file?: string) =>
  page.goto(`/artifacts/skill/${NAME}?tab=files${file ? `&file=${encodeURIComponent(`${ROOT}/${file}`)}` : ""}`);

test.describe("file tree of a large artifact", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/");
    await loginAs(page, "admin");
    if ((await page.request.get(`/api/v1/artifacts/skill/${NAME}`)).status() === 404) {
      const pub = await page.request.post("/api/v1/artifacts", { data: { type: "skill", files: files() }, timeout: 120_000 });
      expect(pub.status(), await pub.text()).toBe(201);
    }
    await logout(page);
    await page.close();
  });

  test("collapsed below the artifact root; a folder opens with aria-expanded", async ({ page }) => {
    await filesTab(page);
    await expect(page.locator(tid("files-tree"))).toBeVisible();
    await expect(page.locator(dir("docs"))).toBeVisible();
    await expect(page.locator(dir("docs"))).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(dir("docs/a00"))).toHaveCount(0);
    expect(await page.locator(`${tid("file-entry")}:visible`).count()).toBeLessThan(50);
    await expect(page.locator(tid("files-expand-all"))).toBeVisible();

    await page.locator(dir("docs")).click();
    await expect(page.locator(dir("docs"))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(dir("docs/a00"))).toBeVisible();
    await expect(page.locator(dir("docs/a00"))).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(dir("docs/a00/b0"))).toHaveCount(0);
  });

  test("the path to the file from the URL is open, the neighbours are not", async ({ page }) => {
    await filesTab(page, "docs/a17/b3/file-7.md");
    const target = page.locator(entry("docs/a17/b3/file-7.md"));
    await expect(target).toBeVisible();
    await expect(target).toHaveAttribute("aria-current", "true");
    for (const p of ["docs", "docs/a17", "docs/a17/b3"]) await expect(page.locator(dir(p))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(dir("docs/a16"))).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(dir("docs/a17/b2"))).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(tid("file-viewer"))).toContainText("docs/a17/b3/file-7.md");
  });

  test("filter: a match with its folders, no match, and clearing restores the tree", async ({ page }) => {
    await filesTab(page);
    const filter = page.locator(tid("files-filter"));
    await expect(filter).toBeVisible();
    // the field has a visible label
    await expect(page.getByLabel(/filter files/i)).toBeVisible();

    await filter.fill("A05/b2/FILE-3");
    await expect(page.locator(entry("docs/a05/b2/file-3.md"))).toBeVisible();
    await expect(page.locator(`${tid("file-entry")}:visible`)).toHaveCount(1);
    await expect(page.locator(tid("files-filter-count"))).toContainText("1");
    await expect(page.locator(tid("files-filter-count"))).toHaveAttribute("aria-live", "polite");

    await filter.fill("nothing-like-this");
    await expect(page.locator(tid("files-filter-empty"))).toBeVisible();
    await expect(page.locator(tid("files-filter-empty"))).toContainText("nothing-like-this");
    await expect(page.locator(`${tid("file-entry")}:visible`)).toHaveCount(0);

    await filter.fill("");
    await expect(page.locator(tid("files-filter-empty"))).toHaveCount(0);
    await expect(page.locator(dir("docs"))).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(dir("docs/a05"))).toHaveCount(0);
  });

  test("a broad filter shows at most 500 rows and says so", async ({ page }) => {
    await filesTab(page);
    await page.locator(tid("files-filter")).fill("file-");
    await expect(page.locator(tid("files-filter-count"))).toContainText("3000");
    await expect(page.locator(tid("files-filter-count"))).toContainText("500");
    expect(await page.locator(tid("file-entry")).count()).toBe(500);
  });

  test("expand all and collapse all; collapse keeps the selected path", async ({ page }) => {
    await filesTab(page, "docs/a02/b1/file-0.md");
    await page.locator(tid("files-expand-all")).click();
    await expect(page.locator(dir("docs/a29/b9"))).toHaveAttribute("aria-expanded", "true");
    await page.locator(tid("files-collapse-all")).click();
    await expect(page.locator(dir("docs/a29"))).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(entry("docs/a02/b1/file-0.md"))).toBeVisible();
  });

  test("negative: a small artifact stays fully expanded, without expand and collapse buttons", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools?tab=files");
    await expect(page.locator(`${tid("file-dir")}[data-path="skills/pdf-tools/references"]`)).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`${tid("file-entry")}[data-path="skills/pdf-tools/references/REFERENCE.md"]`)).toBeVisible();
    await expect(page.locator(tid("files-expand-all"))).toHaveCount(0);
    await expect(page.locator(tid("files-filter"))).toBeVisible();
  });
});
