// fix-accent-contrast: text on a solid fill takes its colour from a paired theme token, and every colour
// class in the web markup names a colour the theme defines. The defect: `bg-accent text-white` is 2.75:1 in the dark
// theme, and `text-accent-fg` / `text-ok` name colours missing from @theme, so Tailwind emits no rule and the text
// inherits the page colour. Nothing failed: a class without a colour is not a build error. This test reads the sources
// and the tokens, so it covers every component, not only the pages an e2e opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./lib/client.mjs";

const WEB = join(ROOT, "packages", "web", "src");

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const SOURCES = files(WEB).map((p) => ({ file: relative(ROOT, p).replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));
const INDEX_CSS = readFileSync(join(WEB, "index.css"), "utf8");
const TOKENS_CSS = readFileSync(join(WEB, "styles", "tokens.css"), "utf8");

/** Colour names the theme defines: `--color-<name>` in @theme. */
const THEME = new Set([...INDEX_CSS.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const BUILTIN = new Set(["white", "black", "transparent", "current", "inherit"]);
const PALETTE =
  /^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$/;
/** Utilities that share a prefix with colour classes but are not colours. */
const NOT_COLOUR = new Set([
  "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl",
  "left", "center", "right", "justify", "start", "end", "wrap", "nowrap", "balance", "pretty", "ellipsis", "clip",
  "solid", "dashed", "dotted", "double", "none", "hidden", "collapse", "separate",
  "cover", "contain", "fixed", "local", "scroll", "repeat", "no-repeat", "top", "bottom",
]);
const SIDE = /^(t|b|l|r|x|y|s|e)(-|$)/;

/** Every class token `text-*`, `bg-*`, `border-*`, `divide-*`, `outline-*`, `ring-*` with a name, variants stripped. */
function colourClasses(text) {
  const out = [];
  const re = /(?<![\w-])(?:[a-z-]+:)*(text|bg|border|divide|outline|ring)-([a-z][a-z0-9-]*)(?:\/\d+)?(?![\w-])/g;
  for (const m of text.matchAll(re)) {
    let name = m[2];
    if (m[1] === "border" || m[1] === "divide") {
      if (SIDE.test(name)) name = name.replace(SIDE, "");
      if (name === "" || /^\d/.test(name) || name === "x" || name === "y") continue;
    }
    if (m[1] === "outline" && /^offset/.test(name)) continue;
    if (m[1] === "ring" && /^(offset|inset)/.test(name)) continue;
    if (NOT_COLOUR.has(name) || /^\d/.test(name)) continue;
    out.push({ cls: m[0], name });
  }
  return out;
}

test("every colour class names a colour the theme defines", () => {
  const unknown = [];
  let seen = 0;
  for (const { file, text } of SOURCES) {
    for (const { cls, name } of colourClasses(text)) {
      seen++;
      if (THEME.has(name) || BUILTIN.has(name) || PALETTE.test(name)) continue;
      unknown.push(`${file}: ${cls}`);
    }
  }
  assert.ok(seen > 500, `only ${seen} colour classes found: the scan or the sources changed`);
  assert.deepEqual([...new Set(unknown)], [], "colour classes without a colour in @theme");
});

test("negative: soft fills, opacity fills and text sizes are not violations", () => {
  const names = colourClasses('className="bg-accent/10 bg-accent-soft text-sm border-t border-l-4 outline-offset-2 hover:text-accent"').map((c) => c.name);
  assert.deepEqual(names, ["accent", "accent-soft", "accent"]);
});

test("no text-white: a constant text colour does not follow the theme", () => {
  const found = SOURCES.filter((s) => /(?<![\w-])(?:[a-z-]+:)*text-white(?![\w-])/.test(s.text)).map((s) => s.file);
  assert.deepEqual(found, []);
});

/**
 * Class strings of a source file. A template literal is split: its static text is one string and every quoted string
 * inside `${…}` is its own, so `base ${on ? "bg-accent text-on-accent" : "text-ink"}` gives three strings, not one
 * string with both branches (a test defect seen on Login.tsx).
 */
function classStrings(text) {
  const out = [];
  for (const lit of text.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g)) {
    const s = lit[0];
    if (!s.startsWith("`")) {
      out.push(s);
      continue;
    }
    const exprs = [...s.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);
    out.push(s.replace(/\$\{[^}]*\}/g, " "));
    for (const e of exprs) for (const q of e.matchAll(/"[^"\n]*"|'[^'\n]*'/g)) out.push(q[0]);
  }
  return out;
}

test("negative: the two branches of a template literal are separate class strings", () => {
  const strings = classStrings('className={`rounded-sf ${on ? "bg-accent text-on-accent" : "bg-surface text-ink"}`}');
  assert.deepEqual(strings, ['`rounded-sf  `', '"bg-accent text-on-accent"', '"bg-surface text-ink"']);
});

test("a solid accent or danger fill with a text colour uses its on-* token", () => {
  const wrong = [];
  let fills = 0;
  for (const { file, text } of SOURCES) {
    for (const s of classStrings(text)) {
      for (const fill of ["accent", "danger"]) {
        if (!new RegExp(`(?<![\\w-])(?:[a-z-]+:)*bg-${fill}(?![\\w/-])`).test(s)) continue;
        const textColours = colourClasses(s).filter((c) => c.cls.replace(/^(?:[a-z-]+:)*/, "").startsWith("text-"));
        if (textColours.length === 0) continue;
        fills++;
        if (!textColours.every((c) => c.name === `on-${fill}`)) wrong.push(`${file}: ${s.slice(0, 120)}`);
      }
    }
  }
  assert.ok(fills >= 40, `only ${fills} filled class strings with a text colour: the scan changed`);
  assert.deepEqual(wrong, []);
});

// --- tokens: every --sf-X with a --sf-on-X pair has 4.5:1 in the light block and both dark blocks ---

function lum(hex) {
  const v = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const f = (x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

function block(selectorRe) {
  const m = selectorRe.exec(TOKENS_CSS);
  assert.ok(m, `block ${selectorRe} not found in tokens.css`);
  const body = TOKENS_CSS.slice(m.index + m[0].length, TOKENS_CSS.indexOf("}", m.index + m[0].length));
  return Object.fromEntries([...body.matchAll(/--sf-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((x) => [x[1], x[2]]));
}

test("paired on-* tokens have 4.5:1 against their fill in every theme block", () => {
  const light = block(/^:root\s*\{/m);
  const blocks = {
    light,
    "dark (system)": { ...light, ...block(/:root:not\(\[data-theme="light"\]\)\s*\{/) },
    "dark (chosen)": { ...light, ...block(/:root\[data-theme="dark"\]\s*\{/) },
  };
  const weak = [];
  for (const [theme, vars] of Object.entries(blocks)) {
    for (const required of ["on-accent", "on-danger"]) assert.ok(vars[required], `${theme}: --sf-${required} is missing`);
    for (const [name, value] of Object.entries(vars)) {
      if (!name.startsWith("on-")) continue;
      const fill = vars[name.slice(3)];
      assert.ok(fill, `${theme}: --sf-${name} has no --sf-${name.slice(3)}`);
      const r = ratio(fill, value);
      if (r < 4.5) weak.push(`${theme}: --sf-${name.slice(3)} ${fill} / --sf-${name} ${value} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(weak, []);
});
