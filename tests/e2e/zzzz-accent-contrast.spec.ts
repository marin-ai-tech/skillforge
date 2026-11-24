// fix-accent-contrast: text on a filled button or link needs 4.5:1 against the fill (WCAG 2.2 SC 1.4.3;
// 3:1 for large text), in the light and the dark theme. The defect: `bg-accent text-white` is 2.75:1 in the dark theme,
// and `text-accent-fg` names a colour the theme lacks, so the text inherits the page colour (3.61:1 light, 2.34:1 dark).
// The test measures computed styles, whatever classes a control uses: an independent oracle for the source scan in
// tests/web-color-classes.test.mjs. Controls that are not available (disabled, aria-disabled) are exempt in WCAG and
// are not measured; a control without its own fill (background as around it) is not measured either.
import { test, expect, type Page } from "@playwright/test";
import { loginAs } from "./auth-helpers";

const PAGES = [
  "/start",
  "/publish",
  "/import",
  "/teams",
  "/me/tokens",
  "/me/password",
  "/admin/users",
  "/admin/backups",
  "/admin/plugins",
  "/admin/agents",
  "/admin/harvest",
  "/admin/rollout",
];
const CONTROLS = 'button, a, [role="button"], input[type="submit"]';

type Measured = { control: string; text: string; fill: string; ratio: number; need: number; accent: boolean };

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
        const v = parse(getComputedStyle(p).backgroundColor);
        if (v && v[3] > 0) return getComputedStyle(p).backgroundColor;
      }
      return getComputedStyle(document.documentElement).backgroundColor;
    };
    // the accent fill as the browser computes it, to count accent-filled controls
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--sf-accent)";
    document.body.appendChild(probe);
    const accentFill = getComputedStyle(probe).backgroundColor;
    probe.remove();

    const out: Measured[] = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || s.visibility === "hidden") continue;
      if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
      const text = (el as HTMLElement).innerText?.trim() ?? "";
      if (text === "") continue;
      const fill = parse(s.backgroundColor);
      if (!fill || fill[3] < 1) continue;
      if (s.backgroundColor === around(el)) continue;
      const fg = parse(s.color);
      if (!fg) continue;
      const a = lum(fg);
      const b = lum(fill);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
      const name = el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? text.slice(0, 30);
      out.push({
        control: `${el.tagName.toLowerCase()}[${name}]`,
        text: s.color,
        fill: s.backgroundColor,
        ratio,
        need: large ? 3 : 4.5,
        accent: s.backgroundColor === accentFill,
      });
    }
    return out;
  }, CONTROLS);
}

for (const theme of ["light", "dark"] as const) {
  test(`text on filled controls has 4.5:1 against the fill (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("skillforge.theme", t), theme);
    const weak: string[] = [];
    let total = 0;
    let accent = 0;
    const check = async (path: string) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.waitForLoadState("networkidle");
      for (const m of await measure(page)) {
        total++;
        if (m.accent) accent++;
        if (m.ratio < m.need) weak.push(`${path} ${m.control}: ${m.text} on ${m.fill} = ${m.ratio.toFixed(2)}:1`);
      }
    };
    await check("/login");
    await loginAs(page, "admin");
    for (const path of PAGES) await check(path);
    expect(total, "fewer than 8 filled controls measured: the selector or the pages changed").toBeGreaterThanOrEqual(8);
    expect(accent, "no accent-filled control measured: the pages changed").toBeGreaterThan(0);
    expect(weak, "text on filled controls below the contrast minimum").toEqual([]);
  });
}
