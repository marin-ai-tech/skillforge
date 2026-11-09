// Acceptance tests: process runner core.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function findProcessRunnerModule() {
  const candidates = [
    "packages/core/src/process-runner.ts",
    "packages/core/src/process/runner.ts",
    "packages/core/src/process/index.ts",
    "packages/core/src/processRunner.ts",
  ];
  for (const rel of candidates) {
    if (existsSync(join(ROOT, rel))) return { rel, src: read(rel) };
  }
  // Fallback: any core src file that mentions spawnIsolated / buildSafeEnv / killProcessTree together.
  const coreSrc = join(ROOT, "packages", "core", "src");
  const stack = [coreSrc];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!name.name.endsWith(".ts")) continue;
      const src = readFileSync(p, "utf8");
      if (
        /spawnIsolated|spawnCommand|spawn\s*\(/.test(src) &&
        /buildSafeEnv|ALLOWED_ENV|SKILLFORGE_/.test(src) &&
        /killProcessTree/.test(src)
      ) {
        return { rel: p.slice(ROOT.length + 1).replace(/\\/g, "/"), src };
      }
    }
  }
  return null;
}

test("shared process runner module exists under packages/core/src and exposes a spawn function", () => {
  const mod = findProcessRunnerModule();
  assert.ok(
    mod,
    "missing packages/core/src/process-runner.ts (or process/runner) with spawn + env + killProcessTree",
  );
  assert.match(
    mod.src,
    /export\s+(async\s+)?function\s+(spawnIsolated|spawnCommand)|export\s+\{[^}]*\b(spawnIsolated|spawnCommand)\b/,
    `${mod.rel} must export a spawn function (spawnIsolated or spawnCommand)`,
  );
});

test("process runner rejects shell injection / uses shell:false", () => {
  const mod = findProcessRunnerModule();
  assert.ok(mod, "missing shared process runner module");
  assert.match(
    mod.src,
    /shell\s*:\s*false/,
    `${mod.rel} must spawn with shell: false to reject shell command injection`,
  );
  assert.doesNotMatch(
    mod.src,
    /shell\s*:\s*true/,
    `${mod.rel} must not enable shell: true`,
  );
});

test("process runner env allowlist scrubs SKILLFORGE_* secrets", () => {
  const mod = findProcessRunnerModule();
  assert.ok(mod, "missing shared process runner module");
  assert.match(
    mod.src,
    /ALLOWED_ENV|allowlist|buildSafeEnv/i,
    `${mod.rel} must define an env allowlist or buildSafeEnv helper`,
  );
  assert.match(
    mod.src,
    /SKILLFORGE_/,
    `${mod.rel} must explicitly handle SKILLFORGE_* secret scrubbing`,
  );
  assert.match(
    mod.src,
    /startsWith\(\s*["']SKILLFORGE_["']\s*\)|\.startsWith\(\s*["']SKILLFORGE_["']\s*\)|!.*SKILLFORGE_|exclude.*SKILLFORGE_|scrub.*SKILLFORGE_/i,
    `${mod.rel} must scrub or reject SKILLFORGE_* names from child env`,
  );
});

test("process runner provides timeout and kill-tree controls", () => {
  const mod = findProcessRunnerModule();
  assert.ok(mod, "missing shared process runner module");
  assert.match(
    mod.src,
    /killProcessTree/,
    `${mod.rel} must expose killProcessTree`,
  );
  assert.match(
    mod.src,
    /timeout|timeoutMs|timeoutS|timeout_s/i,
    `${mod.rel} must support timeout controls`,
  );
  assert.match(
    mod.src,
    /taskkill|SIGKILL|process\.kill\s*\(/,
    `${mod.rel} must implement cross-platform process tree kill`,
  );
});
