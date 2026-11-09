// Acceptance tests: e2e mvp flows.
// No network, no server.
// The base Playwright setup (playwright.config.ts, tests/e2e/*.spec.ts, E2E_PORT) is covered elsewhere;
// the checks below target the MVP layer on top of it: mvp-* scenarios, msedge project, simulate-mvp, scripts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const E2E_DIR = "tests/e2e";
const SIMULATE = "scripts/simulate-mvp.mjs";
const LOCAL_STAND_PORT = "8787"; // default SKILLFORGE_PORT of the local stand

function playwrightConfig() {
  for (const rel of ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs"]) {
    if (existsSync(join(ROOT, rel))) return { rel, src: read(rel) };
  }
  return null;
}

const specFiles = () =>
  existsSync(join(ROOT, E2E_DIR)) ? readdirSync(join(ROOT, E2E_DIR)).filter((n) => n.endsWith(".spec.ts")) : [];
const mvpSpecs = () => specFiles().filter((n) => /^mvp[-_.]/i.test(n));
const mvpSource = () => mvpSpecs().map((n) => read(`${E2E_DIR}/${n}`)).join("\n");

test("E2E entry point: Playwright config + tests/e2e/mvp-*.spec.ts covering first-run /start", () => {
  const cfg = playwrightConfig();
  assert.ok(cfg, "no playwright.config.(ts|js|mjs)");
  assert.match(cfg.src, /testDir\s*:\s*["'`](\.\/)?tests\/e2e["'`]/, `${cfg.rel}: testDir is not tests/e2e`);
  assert.ok(specFiles().length > 0, "tests/e2e has no *.spec.ts");
  assert.ok(mvpSpecs().length > 0, "no tests/e2e/mvp-*.spec.ts (MVP scenarios)");
  const src = mvpSource();
  assert.match(src, /["'`]\/start["'`?#]/, "mvp-* specs do not open the first-run page /start");
  assert.match(src, /starter|checklist|candidates_promoted/i, "mvp-* specs do not exercise the /start checklist / starter pack");
});

test("E2E covers MVP UI flows: teams, notifications, metrics, evals, purge, lifecycle", () => {
  const src = mvpSource();
  assert.ok(src.length > 0, "no tests/e2e/mvp-*.spec.ts to inspect");
  const need = {
    teams: /\bteams?\b|alpha/i,
    notifications: /notification|bell/i,
    metrics: /\/metrics/,
    evals: /evals?\b/i,
    purge: /purge/i,
    lifecycle: /\/lifecycle/,
  };
  const missing = Object.entries(need).filter(([, re]) => !re.test(src)).map(([k]) => k);
  assert.deepEqual(missing, [], `MVP flows without e2e coverage: ${missing.join(", ")}`);
});

test("Playwright config defines an Edge project (channel msedge)", () => {
  const cfg = playwrightConfig();
  assert.ok(cfg, "no playwright.config.(ts|js|mjs)");
  assert.match(cfg.src, /projects\s*:/, `${cfg.rel}: no projects`);
  assert.match(cfg.src, /channel\s*:\s*["'`]msedge["'`]/, `${cfg.rel}: no project with channel "msedge"`);
});

test("scripts/simulate-mvp.mjs exists and walks P0 actors and key flows", () => {
  assert.ok(existsSync(join(ROOT, SIMULATE)), `${SIMULATE} is missing`);
  const src = read(SIMULATE);
  const actors = ["admin", "rev1", "dev1", "viewer1", "alpha"].filter((a) => !new RegExp(`\\b${a}\\b`).test(src));
  assert.deepEqual(actors, [], `${SIMULATE}: P0 actors not referenced: ${actors.join(", ")}`);
  const flows = {
    starterInstall: /starter-packs/,
    promote: /transitions|batch/,
    marketplace: /marketplace\.json/,
    tcIds: /TC-[A-Z0-9]+-?\d+/,
    exitCode: /process\.exit(Code)?\b/,
  };
  const missing = Object.entries(flows).filter(([, re]) => !re.test(src)).map(([k]) => k);
  assert.deepEqual(missing, [], `${SIMULATE}: key flows missing: ${missing.join(", ")}`);
});

test("E2E_PORT is configurable everywhere and never the local stand port 8787", () => {
  const cfg = playwrightConfig();
  assert.ok(cfg, "no playwright.config.(ts|js|mjs)");
  const files = [cfg.rel, `${E2E_DIR}/state.ts`, SIMULATE];
  for (const rel of files) {
    assert.ok(existsSync(join(ROOT, rel)), `${rel} is missing`);
    const src = read(rel);
    const usesEnv = /process\.env\.E2E_PORT|process\.env\[["']E2E_PORT["']\]/.test(src);
    const importsPort = rel === cfg.rel && /import\s*\{[^}]*\bPORT\b[^}]*\}\s*from\s*["'`]\.\/tests\/e2e\/state(\.ts)?["'`]/.test(src);
    assert.ok(usesEnv || importsPort, `${rel}: port is not taken from E2E_PORT`);
    assert.doesNotMatch(src, new RegExp(`(?<![\\d.])${LOCAL_STAND_PORT}(?!\\d)`), `${rel}: hardcodes the local stand port ${LOCAL_STAND_PORT}`);
    const def = /E2E_PORT\s*\]?\s*(\?\?|\|\|)\s*["'`]?(\d+)/.exec(src);
    if (def) assert.notEqual(def[2], LOCAL_STAND_PORT, `${rel}: E2E_PORT defaults to ${LOCAL_STAND_PORT}`);
  }
});

test("package.json has scripts for the MVP e2e suite and simulate-mvp", () => {
  const scripts = JSON.parse(read("package.json")).scripts ?? {};
  assert.ok(scripts.e2e, "the existing `e2e` script must remain");
  const values = Object.values(scripts);
  assert.ok(values.some((v) => /simulate-mvp\.mjs/.test(v)), "no script runs scripts/simulate-mvp.mjs");
  assert.ok(
    Object.entries(scripts).some(([k, v]) => k !== "e2e" && /playwright\s+test/.test(v) && /mvp/.test(`${k} ${v}`)),
    "no script runs the MVP Playwright scenarios (e.g. `e2e:mvp`)",
  );
});
