// The "By type" block on the home page:
// 1) each counter equals the API total for every type from /api/v1/artifact-types (regression: plugin and settings were always 0 —
//    counters were computed from a fallback list of four types and never recalculated);
// 2) the plugins tile is labeled "Plugins" and links to all plugins;
// 3) there are no gaps between tile borders (a grid with shared lines), including when rows wrap.
// The `zzz-...` name: the spec creates a plugin and a profile itself if they are missing, and does not depend on the order of other specs.
import { test, expect, type Page } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loginAs, logout } from "./auth-helpers.ts";
import { ROOT } from "./state.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

function bundle(dir: string, prefix: string) {
  const out: { path: string; content_base64: string }[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: `${prefix}/${relative(dir, p).replace(/\\/g, "/")}`, content_base64: readFileSync(p).toString("base64") });
    }
  };
  walk(dir);
  return out;
}

async function total(page: Page, type: string): Promise<number> {
  const r = await page.request.get(`/api/v1/artifacts?type=${type}&limit=1&offset=0`);
  expect(r.status()).toBe(200);
  return ((await r.json()) as { total: number }).total;
}

async function ensureOne(page: Page, type: string, dir: string, prefix: string) {
  if ((await total(page, type)) > 0) return;
  const pub = await page.request.post("/api/v1/artifacts", { data: { files: bundle(dir, prefix) } });
  expect(pub.status(), await pub.text()).toBe(201);
}

test.describe("home: By type block", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await ensureOne(page, "plugin", join(ROOT, "tests", "fixtures", "cc-plugins", "team-kit"), "team-kit");
    await ensureOne(page, "settings", join(ROOT, "tests", "fixtures", "settings", "team-baseline"), "team-baseline");
  });

  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("counters of all types equal the API total (plugin and settings are not 0)", async ({ page }) => {
    const types = ((await (await page.request.get("/api/v1/artifact-types")).json()) as { items: { id: string }[] }).items.map((t) => t.id);
    expect(types).toEqual(expect.arrayContaining(["plugin", "settings"]));
    await page.goto("/");
    for (const type of types) {
      const expected = await total(page, type);
      if (type === "plugin" || type === "settings") expect(expected, `${type}: no data to check`).toBeGreaterThan(0);
      await expect(page.locator(tid(`home-count-${type}`)), type).toContainText(String(expected));
    }
  });

  test("Plugins tile: label without Claude Code, links to all plugins", async ({ page }) => {
    await page.goto("/");
    const tile = page.locator(tid("home-count-plugin"));
    await expect(tile).toContainText("Plugins");
    await expect(tile).not.toContainText("Claude Code");
    await tile.click();
    await expect(page).toHaveURL(/\/artifacts\?type=plugin$/);
    await expect(page.locator(tid("browse-tab-plugin"))).toContainText("Plugins");
    const cards = page.locator(tid("artifact-card"));
    await expect(cards.first()).toBeVisible();
    expect(await cards.evaluateAll((els) => els.every((e) => e.getAttribute("data-type") === "plugin"))).toBe(true);
  });

  for (const width of [1280, 600]) {
    test(`tiles have no gaps between borders (${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const tiles = page.locator('[data-testid^="home-count-"]');
      await expect(tiles.first()).toBeVisible();
      const boxes = (await tiles.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      )) as { x: number; y: number; w: number; h: number }[];
      expect(boxes.length).toBeGreaterThanOrEqual(6);
      const gaps: string[] = [];
      for (let i = 1; i < boxes.length; i++) {
        const a = boxes[i - 1]!;
        const b = boxes[i]!;
        if (Math.abs(a.y - b.y) < 1) {
          const gap = b.x - (a.x + a.w);
          if (gap > 1) gaps.push(`horizontally ${i - 1}→${i}: ${gap.toFixed(1)} px`);
        }
      }
      const rows = [...new Set(boxes.map((b) => Math.round(b.y)))].sort((p, q) => p - q);
      for (let r = 1; r < rows.length; r++) {
        const prev = boxes.filter((b) => Math.round(b.y) === rows[r - 1]);
        const gap = rows[r]! - Math.max(...prev.map((b) => b.y + b.h));
        if (gap > 1) gaps.push(`between rows ${r - 1}→${r}: ${gap.toFixed(1)} px`);
      }
      expect(gaps).toEqual([]);
    });
  }
});
