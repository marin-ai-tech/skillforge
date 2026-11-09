// Acceptance tests: demo seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const ROLE_MARKERS = ["admin", "reviewer", "contributor", "viewer"];
const USER_MARKERS = ["rev1", "dev1", "viewer1"];
const ARTIFACT_TYPES = ["skill", "command", "agent", "hook", "plugin", "settings"];

function findSeedDemoScript() {
  const candidates = [
    "scripts/seed-demo.ts",
    "scripts/seed-demo.mjs",
    "scripts/seed-demo.js",
    "scripts/seed-demo.mts",
    "packages/cli/src/commands/seed.ts",
    "packages/cli/src/commands/seed-demo.ts",
  ];
  for (const rel of candidates) {
    if (existsSync(join(ROOT, rel))) return { rel, src: read(rel) };
  }
  const scriptsDir = join(ROOT, "scripts");
  if (existsSync(scriptsDir)) {
    for (const name of readdirSync(scriptsDir)) {
      if (!/seed-?demo/i.test(name)) continue;
      if (!/\.(ts|mts|mjs|js|cjs)$/.test(name)) continue;
      const rel = `scripts/${name}`;
      return { rel, src: read(rel) };
    }
  }
  return null;
}

function packageJsonHasSeedDemo() {
  const pkgPath = join(ROOT, "package.json");
  if (!existsSync(pkgPath)) return false;
  const pkg = JSON.parse(read("package.json"));
  const scripts = pkg.scripts || {};
  return typeof scripts["seed:demo"] === "string" && scripts["seed:demo"].length > 0;
}

function cliRegistersSeedDemo() {
  const indexPath = join(ROOT, "packages", "cli", "src", "index.ts");
  if (!existsSync(indexPath)) return false;
  const src = read("packages/cli/src/index.ts");
  return (
    /seed\s*:\s*demo|seed:demo|\.command\(\s*["']seed["']/.test(src) &&
    /demo/i.test(src)
  );
}

function seedEntryExists() {
  return Boolean(findSeedDemoScript()) || packageJsonHasSeedDemo() || cliRegistersSeedDemo();
}

function combinedSeedSources() {
  const parts = [];
  const script = findSeedDemoScript();
  if (script) parts.push(script.src);
  if (packageJsonHasSeedDemo()) {
    parts.push(String(JSON.parse(read("package.json")).scripts["seed:demo"]));
  }
  // Include design markers only as last-resort? No — assert implementation sources.
  return parts.join("\n");
}

function hasFourRolesAndSixTypes(src) {
  const roleOk =
    ROLE_MARKERS.every((r) => new RegExp(r, "i").test(src)) &&
    (USER_MARKERS.every((u) => src.includes(u)) ||
      (/viewer/.test(src) && /contributor/.test(src) && /reviewer/.test(src) && /admin/.test(src)));
  const typesOk = ARTIFACT_TYPES.every((t) => {
    const re = new RegExp(
      `["']${t}["']|demo-${t}|type\\s*[:=]\\s*["']${t}["']|ArtifactType.*${t}`,
      "i",
    );
    return re.test(src) || src.includes(t);
  });
  // Require explicit presence of all six type tokens and role tokens in seed script body.
  const typeTokens = ARTIFACT_TYPES.filter((t) => src.includes(`"${t}"`) || src.includes(`'${t}'`) || src.includes(`demo-${t}`) || new RegExp(`\\b${t}\\b`).test(src));
  const rolesMentioned = ROLE_MARKERS.filter((r) => new RegExp(`\\b${r}\\b`, "i").test(src));
  return roleOk && typesOk && typeTokens.length >= 6 && rolesMentioned.length >= 4;
}

function hasIdempotency(src) {
  return (
    /exists\s*\/\s*skip|exists\/skip|idempotent|skip if exists|if\s*\(.*exists|getUserByUsername|getArtifactByTypeName|already exists|upsert/i.test(
      src,
    ) ||
    (/skip/i.test(src) && /exist/i.test(src))
  );
}

function localResetCompatible() {
  const ps1 = existsSync(join(ROOT, "scripts", "local-start.ps1"));
  const sh = existsSync(join(ROOT, "scripts", "local-start.sh"));
  const pkg = JSON.parse(read("package.json"));
  const hasLocalReset =
    typeof (pkg.scripts || {})["local:reset"] === "string" &&
    String(pkg.scripts["local:reset"]).length > 0;
  const script = findSeedDemoScript();
  const seedSrc = script ? script.src : "";
  const seedMentionsReset =
    /local:reset|local-start|LOCAL_RESET|reset compat|after reset|data dir|SKILLFORGE_DATA_DIR/i.test(
      seedSrc,
    );
  // Seed must not replace reset machinery: local-start scripts remain; seed is separate.
  const seedDoesNotOverwriteLocalStart =
    !script ||
    (script.rel !== "scripts/local-start.ps1" && script.rel !== "scripts/local-start.sh");
  // Pass when seed entry exists alongside local:reset and either documents reset compatibility
  // or simply coexists without modifying local-start (checked by presence of both surfaces).
  return (
    hasLocalReset &&
    (ps1 || sh) &&
    seedEntryExists() &&
    seedDoesNotOverwriteLocalStart &&
    (seedMentionsReset || packageJsonHasSeedDemo())
  );
}

test("demo seed entry point exists (scripts/seed-demo.* or package.json seed:demo or CLI seed demo)", () => {
  assert.equal(
    seedEntryExists(),
    true,
    "missing scripts/seed-demo.ts|.mjs (or package.json scripts.seed:demo / CLI seed demo) for npm run seed:demo",
  );
  // Prefer npm script wiring once implementation lands
  if (findSeedDemoScript()) {
    assert.equal(
      packageJsonHasSeedDemo() || cliRegistersSeedDemo(),
      true,
      "scripts/seed-demo.* exists but neither package.json seed:demo nor CLI seed demo is wired",
    );
  }
});

test("demo seed covers 4 roles (admin/reviewer/contributor/viewer) and 6 artifact types", () => {
  const script = findSeedDemoScript();
  assert.ok(
    script,
    "missing scripts/seed-demo.ts|.mjs to assert role and artifact-type markers",
  );
  assert.equal(
    hasFourRolesAndSixTypes(script.src),
    true,
    `${script.rel} must mention roles admin/reviewer/contributor/viewer (users rev1/dev1/viewer1) and all six ArtifactType values skill/command/agent/hook/plugin/settings`,
  );
});

test("demo seed is idempotent (exists/skip or equivalent on re-run)", () => {
  const script = findSeedDemoScript();
  assert.ok(script, "missing seed-demo script for idempotency assertion");
  assert.equal(
    hasIdempotency(script.src),
    true,
    `${script.rel} must implement or document idempotency (exists/skip, getUserByUsername, getArtifactByTypeName, upsert, or equivalent)`,
  );
});

test("demo seed is compatible with npm run local:reset (coexists; does not replace reset)", () => {
  assert.equal(
    localResetCompatible(),
    true,
    "seed:demo must coexist with package.json local:reset and scripts/local-start.*; seed script should mention reset/data-dir compatibility or be wired as a separate seed:demo script",
  );
});
