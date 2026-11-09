// e2e tests for catalog browsing. The registry is seeded in global-setup.ts:
// skill pdf-tools (0.1.0, 0.2.0 «Add merge step»), skill linker, command propose, agent handoff-executor
// (alice, reckon/run-42), hook destructive-guard (alice; moved to active by reviewer rita). Everything else is published by admin;
// users admin/alice/bob/rita.
import { test, expect } from "@playwright/test";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("shell", () => {
  test("unknown artifact → not-found with the name", async ({ page }) => {
    await page.goto("/artifacts/skill/does-not-exist");
    await expect(page.locator(tid("not-found"))).toContainText("does-not-exist");
  });

  test("unknown path → not-found", async ({ page }) => {
    await page.goto("/nope/nothing");
    await expect(page.locator(tid("not-found"))).toBeVisible();
  });

  test("global search: Ctrl+K, type, Enter → /artifacts?q=", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+K");
    await expect(page.locator(tid("nav-search"))).toBeFocused();
    await page.keyboard.type("pdf");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/artifacts\?.*q=pdf/);
    await expect(page.locator(tid("browse-search"))).toHaveValue("pdf");
  });

  test("theme: two presses → dark, persists after reload", async ({ page }) => {
    await page.goto("/");
    await page.locator(tid("theme-toggle")).click();
    await page.locator(tid("theme-toggle")).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("skillforge.theme"))).toBe("dark");
  });
});

test.describe("home", () => {
  test("counters by type and collections", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/^SkillForge/);
    await expect(page.locator(tid("home-count-skill"))).toContainText("2");
    await expect(page.locator(tid("home-count-command"))).toContainText("1");
    await expect(page.locator(tid("home-count-agent"))).toContainText("1");
    await expect(page.locator(tid("home-count-hook"))).toContainText("1");
    await expect(page.locator(`${tid("home-recent")} ${tid("artifact-card")}`)).toHaveCount(5);
    await expect(page.locator(`${tid("home-review")} ${tid("artifact-card")}`)).toHaveCount(4);
    await page.locator(tid("home-count-skill")).click();
    await expect(page).toHaveURL(/\/artifacts\?.*type=skill/);
  });
});

test.describe("catalog", () => {
  test("type filter via URL", async ({ page }) => {
    await page.goto("/artifacts?type=hook");
    await expect(page).toHaveTitle(/^Catalog · SkillForge/);
    await expect(page.locator(tid("browse-tab-hook"))).toHaveAttribute("aria-selected", "true");
    const cards = page.locator(`${tid("browse-results")} ${tid("artifact-card")}`);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("data-type", "hook");
    await expect(page.locator(tid("browse-total"))).toContainText("1");
  });

  test("debounced search written to the URL", async ({ page }) => {
    await page.goto("/artifacts");
    await page.locator(tid("browse-search")).fill("pdf");
    await expect(page.locator(`${tid("browse-results")} ${tid("artifact-card")}[data-name="pdf-tools"]`)).toBeVisible({ timeout: 1000 });
    await expect(page).toHaveURL(/q=pdf/);
    await expect(page.locator(`${tid("browse-results")} ${tid("artifact-card")}`)).toHaveCount(1);
  });

  test("tag filter and reset", async ({ page }) => {
    await page.goto("/artifacts?tag=workflow");
    await expect(page.locator(tid("browse-tag"))).toContainText("workflow");
    const cards = page.locator(`${tid("browse-results")} ${tid("artifact-card")}`);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("data-name", "propose");
    await page.locator(`${tid("browse-tag")} button`).click();
    await expect(page).not.toHaveURL(/tag=/);
    await expect(cards).toHaveCount(5);
  });

  test("empty result", async ({ page }) => {
    await page.goto("/artifacts?q=zzzznothing");
    await expect(page.locator(tid("empty-state"))).toBeVisible();
    await expect(page.locator(tid("browse-total"))).toContainText("0");
  });

  test("tabs with counters and pagination", async ({ page }) => {
    await page.goto("/artifacts");
    await expect(page.locator(tid("browse-tab-all"))).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(tid("browse-tab-skill"))).toContainText("2");
    await expect(page.locator(tid("browse-pagination"))).toBeVisible();
    await expect(page.locator(tid("page-next"))).toBeDisabled();
    await page.locator(tid("browse-tab-agent")).click();
    await expect(page).toHaveURL(/type=agent/);
    await expect(page.locator(`${tid("browse-results")} ${tid("artifact-card")}`)).toHaveCount(1);
  });

  // Tab counters are computed with the same filters as the list.
  // Negative case for each page filter: a value with no matches gives 0 on all tabs, not the whole registry.
  test("a filter narrows the tab counters too", async ({ page }) => {
    const tabs = page.locator('[role="tab"][data-testid^="browse-tab-"]');
    for (const key of ["q", "tag", "team", "owner", "label"]) {
      await page.goto(`/artifacts?${key}=zzzz-no-match`);
      await expect(page.locator(tid("browse-total"))).toContainText("0");
      await expect(page.locator(tid("browse-tab-all"))).toHaveText(/\d$/);
      for (const tab of await tabs.all()) {
        await expect(tab, `${key}: ${await tab.getAttribute("data-testid")}`).toHaveText(/ 0$/);
      }
    }
    await page.goto("/artifacts?owner=alice");
    await expect(page.locator(`${tid("browse-results")} ${tid("artifact-card")}`).first()).toBeVisible();
    const total = page.locator(tid("browse-total"));
    const n = (await total.textContent())?.match(/\d+/)?.[0];
    await expect(page.locator(tid("browse-tab-all")), "All = browse-total with owner=alice").toHaveText(
      new RegExp(` ${n}$`),
    );
  });

  test("card in the list: content and links", async ({ page }) => {
    await page.goto("/artifacts?type=command");
    const card = page.locator(`${tid("artifact-card")}[data-name="propose"]`);
    await expect(card).toContainText("OPSX: Propose");
    await expect(card).toContainText("command");
    await expect(card).toContainText("workflow");
    await expect(card).toContainText("0.1.0");
    await card.getByText("workflow", { exact: true }).click();
    await expect(page).toHaveURL(/tag=workflow/);
    await page.goto("/artifacts?type=command");
    await card.locator("a[href='/artifacts/command/propose']").first().click();
    await expect(page).toHaveURL(/\/artifacts\/command\/propose/);
  });
});

test.describe("artifact card", () => {
  test("header and title", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools");
    await expect(page).toHaveTitle(/^pdf-tools · SkillForge/);
    await expect(page.locator(tid("detail-name"))).toContainText("pdf-tools");
    await expect(page.locator(tid("detail-type"))).toContainText("skill");
    await expect(page.locator(tid("detail-status"))).toContainText("candidate");
    await expect(page.locator(tid("detail-version"))).toContainText("0.2.0");
    await expect(page.locator(tid("detail-description"))).toContainText("Extracts text and tables");
  });

  test("overview: markdown without frontmatter, metadata", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools");
    const md = page.locator(tid("overview-markdown"));
    await expect(md).toContainText("PDF tools");
    await expect(md).not.toContainText("name: pdf-tools");
    await expect(page.locator(tid("meta-digest"))).toBeVisible();
    await expect(page.locator(tid("meta-published-by"))).toContainText("admin");
  });

  test("agent overview: provenance and author", async ({ page }) => {
    await page.goto("/artifacts/agent/handoff-executor");
    await expect(page.locator(tid("meta-provenance"))).toContainText("reckon");
    await expect(page.locator(tid("meta-provenance"))).toContainText("run-42");
    await expect(page.locator(tid("meta-published-by"))).toContainText("alice");
    await expect(page.locator(tid("overview-markdown"))).toContainText("liaison");
  });

  test("hook: overview from README, files", async ({ page }) => {
    await page.goto("/artifacts/hook/destructive-guard");
    await expect(page.locator(tid("overview-markdown"))).toContainText("catastrophic shell commands");
    await page.locator(tid("tab-files")).click();
    await expect(page.locator(`${tid("file-entry")}[data-path="hooks/hooks.json"]`)).toBeVisible();
  });

  test("files: tree and file view with the path in the URL", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools");
    await page.locator(tid("tab-files")).click();
    await expect(page).toHaveURL(/tab=files/);
    await expect(page.locator(tid("file-entry"))).toHaveCount(2);
    await page.locator(`${tid("file-entry")}[data-path="skills/pdf-tools/references/REFERENCE.md"]`).click();
    await expect(page.locator(tid("file-viewer"))).toContainText("AcroForm");
    await expect(page).toHaveURL(/file=skills%2Fpdf-tools%2Freferences%2FREFERENCE\.md|file=skills\/pdf-tools\/references\/REFERENCE\.md/);
  });

  test("files: directory tree, a file shows only its name", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools?tab=files");
    for (const dir of ["skills", "skills/pdf-tools", "skills/pdf-tools/references"]) {
      await expect(page.locator(`${tid("file-dir")}[data-path="${dir}"]`)).toBeVisible();
    }
    const entry = page.locator(`${tid("file-entry")}[data-path="skills/pdf-tools/references/REFERENCE.md"]`);
    await expect(entry).toContainText("REFERENCE.md");
    await expect(entry).not.toContainText("skills/pdf-tools/references/REFERENCE.md");
  });

  test("versions: order, changelog, version selection", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools?tab=versions");
    const entries = page.locator(`${tid("versions-list")} ${tid("version-entry")}`);
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toHaveAttribute("data-version", "0.2.0");
    await expect(entries.nth(1)).toHaveAttribute("data-version", "0.1.0");
    await expect(entries.nth(0)).toContainText("Add merge step");
    await page.locator(tid("version-select")).selectOption("0.1.0");
    await expect(page.locator(tid("detail-version"))).toContainText("0.1.0");
    await expect(page).toHaveURL(/version=0\.1\.0/);
    await page.locator(tid("tab-overview")).click();
    await expect(page.locator(tid("overview-markdown"))).not.toContainText("Merge with");
  });

  test("audit: two publish records, the first is 0.2.0", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools?tab=audit");
    const entries = page.locator(`${tid("audit-list")} ${tid("audit-entry")}`);
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toHaveAttribute("data-action", "publish");
    await expect(entries.nth(0)).toContainText("0.2.0");
    await expect(entries.nth(1)).toContainText("0.1.0");
  });
});
