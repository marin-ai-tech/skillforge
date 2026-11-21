// field-border-contrast: the border of a text field, a list and a text area is what shows where to type, so it needs
// 3:1 against the background around the field (WCAG 2.2 SC 1.4.11), in the light and the dark theme. The test
// measures every visible field with a border on pages with forms, whatever class the field uses: a new form cannot
// bring back a faint border. Fields without a border (inside a framed container) are not measured.
import { test, expect, type Page } from "@playwright/test";
import { loginAs } from "./auth-helpers";

const PAGES = ["/artifacts", "/publish", "/import", "/admin/users", "/me/password", "/me/tokens", "/teams"];
const FIELDS =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]):not([type="range"]), select, textarea';

type Measured = { field: string; border: string; around: string; ratio: number };

async function measure(page: Page): Promise<Measured[]> {
  return page.evaluate((selector) => {
    const parse = (c: string): [number, number, number, number] | null => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null;
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const around = (el: Element): string => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const c = getComputedStyle(p).backgroundColor;
        const v = parse(c);
        if (v && v[3] > 0) return c;
      }
      return getComputedStyle(document.documentElement).backgroundColor;
    };
    const out: Array<{ field: string; border: string; around: string; ratio: number }> = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || s.visibility === "hidden") continue;
      const border = parse(s.borderTopColor);
      if (!border || border[3] === 0 || parseFloat(s.borderTopWidth) === 0 || s.borderTopStyle === "none") continue;
      const bg = around(el);
      const a = lum(border);
      const b = lum(parse(bg) ?? [255, 255, 255, 1]);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const name =
        el.getAttribute("data-testid") ?? el.getAttribute("name") ?? el.id ?? el.getAttribute("aria-label") ?? "";
      out.push({ field: `${el.tagName.toLowerCase()}#${name}`, border: s.borderTopColor, around: bg, ratio });
    }
    return out;
  }, FIELDS);
}

for (const theme of ["light", "dark"] as const) {
  test(`field borders have 3:1 against their background (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("skillforge.theme", t), theme);
    await loginAs(page, "admin");
    const weak: string[] = [];
    let total = 0;
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.waitForLoadState("networkidle");
      const fields = await measure(page);
      total += fields.length;
      for (const f of fields) {
        if (f.ratio < 3) weak.push(`${path} ${f.field}: ${f.border} on ${f.around} = ${f.ratio.toFixed(2)}:1`);
      }
    }
    expect(total, "no bordered fields measured: the selector or the pages changed").toBeGreaterThan(10);
    expect(weak, "field borders below 3:1").toEqual([]);
  });
}
