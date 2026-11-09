// Acceptance tests: diagnostics logging.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function findLoggingModule() {
  const candidates = [
    "packages/server/src/logging.ts",
    "packages/server/src/lib/logging.ts",
    "packages/server/src/diagnostics/logging.ts",
    "packages/server/src/diagnostics/log.ts",
  ];
  for (const rel of candidates) {
    if (existsSync(join(ROOT, rel))) return { rel, src: read(rel) };
  }
  // Fallback: any server src file that both configures SKILLFORGE_LOG_LEVEL and redacts.
  const serverSrc = join(ROOT, "packages", "server", "src");
  const stack = [serverSrc];
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
      if (/SKILLFORGE_LOG_LEVEL/.test(src) && /redact/i.test(src)) {
        return { rel: p.slice(ROOT.length + 1).replace(/\\/g, "/"), src };
      }
    }
  }
  return null;
}

test("production 500 handler hides internal error text", () => {
  const app = read("packages/server/src/app.ts");
  assert.match(
    app,
    /setErrorHandler/,
    "app.ts must register setErrorHandler for unified 500 responses",
  );
  const serverSrc = join(ROOT, "packages", "server", "src");
  const stack = [serverSrc];
  let foundSafeShape = false;
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
        /internal_error/.test(src) &&
        (/request_id/.test(src) || /requestId/.test(src))
      ) {
        foundSafeShape = true;
        break;
      }
    }
    if (foundSafeShape) break;
  }
  assert.equal(
    foundSafeShape,
    true,
    "server must define production 500 body with internal_error and request_id",
  );
});

test("logging redacts password token and secret values", () => {
  const mod = findLoggingModule();
  assert.ok(mod, "missing server logging module (logging.ts or SKILLFORGE_LOG_LEVEL + redact)");
  assert.match(
    mod.src,
    /SKILLFORGE_LOG_LEVEL/,
    `${mod.rel} must honor SKILLFORGE_LOG_LEVEL`,
  );
  assert.match(mod.src, /redact/i, `${mod.rel} must implement redaction`);
  assert.match(
    mod.src,
    /password|token|secret/i,
    `${mod.rel} must redact password/token/secret material`,
  );
  assert.match(
    mod.src,
    /\[REDACTED\]|REDACTED/,
    `${mod.rel} must replace secrets with REDACTED marker`,
  );
});

test("skillforge doctor --bundle command and server bundle support exist", () => {
  const doctorPath = join(ROOT, "packages", "cli", "src", "commands", "doctor.ts");
  assert.ok(existsSync(doctorPath), "missing packages/cli/src/commands/doctor.ts");
  const doctor = read("packages/cli/src/commands/doctor.ts");
  assert.match(
    doctor,
    /bundle/i,
    "doctor.ts must implement --bundle / bundle support",
  );
  const index = read("packages/cli/src/index.ts");
  assert.match(
    index,
    /doctor/i,
    "packages/cli/src/index.ts must register the doctor command",
  );
  const serverSrc = join(ROOT, "packages", "server", "src");
  const stack = [serverSrc];
  let foundBundle = false;
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
      if (/diagnostics\/bundle|diagnostics\.bundle|doctor.*bundle|bundle.*diagnostics/i.test(src)) {
        foundBundle = true;
        break;
      }
    }
    if (foundBundle) break;
  }
  assert.equal(
    foundBundle,
    true,
    "server must expose diagnostics bundle endpoint or builder stub",
  );
});
