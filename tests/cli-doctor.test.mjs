// Acceptance tests: cli doctor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function findProjectCommandModule() {
  const candidates = [
    "packages/cli/src/commands/project.ts",
    "packages/cli/src/commands/project-status.ts",
    "packages/cli/src/commands/projectStatus.ts",
  ];
  for (const rel of candidates) {
    if (existsSync(join(ROOT, rel))) return { rel, src: read(rel) };
  }
  const cmdDir = join(ROOT, "packages", "cli", "src", "commands");
  if (!existsSync(cmdDir)) return null;
  for (const name of readdirSync(cmdDir)) {
    if (!name.endsWith(".ts")) continue;
    if (!/project/i.test(name)) continue;
    const rel = `packages/cli/src/commands/${name}`;
    const src = read(rel);
    if (/status/i.test(src) && /runProject|projectStatus|ProjectStatus/i.test(src)) {
      return { rel, src };
    }
  }
  return null;
}

function doctorHasNonBundleHealthPath(doctorSrc) {
  // Fail today: current doctor only errors when !opts.bundle with usage requiring --bundle.
  // Pass after: a real checklist / health path exists for the non-bundle case.
  const onlyUsageGate =
    /if\s*\(\s*!opts\.bundle\s*\)[\s\S]{0,200}usage:\s*skillforge doctor --bundle/i.test(
      doctorSrc,
    );
  if (onlyUsageGate) return false;
  const hasChecks =
    /\bchecks\b/.test(doctorSrc) &&
    (/server_health|cli_config|registry_url|health\/status|runDoctorChecks|checklist/i.test(
      doctorSrc,
    ) ||
      (/ok\b/.test(doctorSrc) && /summary|status/i.test(doctorSrc)));
  const mentionsNonBundle =
    /without\s+--bundle|non-bundle|health\s*checks|checklist/i.test(doctorSrc) || hasChecks;
  return hasChecks || (mentionsNonBundle && !onlyUsageGate);
}

test("skillforge doctor without --bundle has a non-bundle health/status path", () => {
  const doctorPath = join(ROOT, "packages", "cli", "src", "commands", "doctor.ts");
  assert.ok(existsSync(doctorPath), "missing packages/cli/src/commands/doctor.ts");
  const doctor = read("packages/cli/src/commands/doctor.ts");
  const index = read("packages/cli/src/index.ts");
  assert.match(index, /\.command\(\s*["']doctor["']/, "index.ts must register doctor");
  assert.equal(
    doctorHasNonBundleHealthPath(doctor),
    true,
    "doctor.ts must implement a non-bundle health/status checklist (not only usage: doctor --bundle)",
  );
});

test("skillforge project status is registered and supports --json", () => {
  const index = read("packages/cli/src/index.ts");
  assert.match(
    index,
    /\.command\(\s*["']project["']/,
    "packages/cli/src/index.ts must register a project command group",
  );
  assert.match(
    index,
    /project[\s\S]{0,800}\.command\(\s*["']status["']|runProjectStatus|project status/i,
    "packages/cli/src/index.ts must wire project status subcommand",
  );
  const mod = findProjectCommandModule();
  assert.ok(
    mod,
    "missing packages/cli/src/commands/project.ts (or project-status) implementing status",
  );
  // --json is a global on CLI; status path must honor ctx.out.json / printJson
  assert.match(
    mod.src,
    /json|printJson|--json/i,
    `${mod.rel} must support JSON output for project status`,
  );
});

test("doctor and project status use well-defined exit codes without throwing on missing config", () => {
  const doctor = read("packages/cli/src/commands/doctor.ts");
  assert.match(
    doctor,
    /setExit\s*\(|EXIT\./,
    "doctor.ts must set well-defined EXIT codes via setExit/EXIT",
  );
  // Non-bundle path should handle missing config / unreachable without rethrowing blindly
  assert.match(
    doctor,
    /missing|config|UNREACHABLE|INVALID_INPUT|VALIDATION|noRegistry|requireClient/i,
    "doctor.ts must handle common missing-config / unreachable cases explicitly",
  );
  const mod = findProjectCommandModule();
  assert.ok(mod, "missing project status command module for exit-code assertions");
  assert.match(
    mod.src,
    /setExit\s*\(|EXIT\./,
    `${mod.rel} must set well-defined EXIT codes via setExit/EXIT`,
  );
  assert.match(
    mod.src,
    /missing_config|missing config|noRegistry|config|INVALID_INPUT|VALIDATION|UNREACHABLE/i,
    `${mod.rel} must handle missing-config without relying on unhandled throws`,
  );
});

test("JSON schema documents ok, checks, and status/summary keys", () => {
  const doctor = read("packages/cli/src/commands/doctor.ts");
  const mod = findProjectCommandModule();
  assert.ok(mod, "missing project status module for JSON schema assertions");
  const combined = `${doctor}\n${mod.src}`;
  assert.match(combined, /["']ok["']|\bok\s*:/, "JSON output must include ok");
  assert.match(combined, /["']checks["']|\bchecks\s*:/, "JSON output must include checks");
  assert.match(
    combined,
    /["']status["']|\bstatus\s*:|["']summary["']|\bsummary\s*:/,
    "JSON output must include status and/or summary",
  );
  // Ensure printJson (or equivalent) is used on the non-bundle / status paths
  assert.match(
    combined,
    /printJson|out\.json/i,
    "doctor/project status must emit JSON via printJson or ctx.out.json",
  );
});