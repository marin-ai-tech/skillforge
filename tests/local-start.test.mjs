// Acceptance tests: local start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/client.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("package.json defines local:start, local:stop, local:reset, and cli:link", () => {
  const pkg = JSON.parse(read("package.json"));
  const scripts = pkg.scripts ?? {};
  for (const name of ["local:start", "local:stop", "local:reset", "cli:link"]) {
    assert.equal(typeof scripts[name], "string", `missing npm script ${name}`);
    assert.ok(scripts[name].trim().length > 0, `empty npm script ${name}`);
  }
  assert.match(scripts["cli:link"], /npm\s+link/, "cli:link should run npm link");
  assert.match(scripts["cli:link"], /@skillforge\/cli/, "cli:link should target @skillforge/cli");
});

test("scripts/local-start.ps1 and scripts/local-start.sh exist", () => {
  assert.ok(existsSync(join(ROOT, "scripts", "local-start.ps1")), "missing scripts/local-start.ps1");
  assert.ok(existsSync(join(ROOT, "scripts", "local-start.sh")), "missing scripts/local-start.sh");
});

// Behavioral check instead of a regex over the source: seedAdmin from the built module
// replaces a stale password file and sets mode 0600 on POSIX.
test("seed writes initial-admin-password.txt owner-only, replacing a stale file", async () => {
  const dist = (p) => pathToFileURL(join(ROOT, "packages", "server", "dist", p)).href;
  const { openDatabase, migrate } = await import(dist("db.js"));
  const { seedAdmin, initialAdminPasswordPath } = await import(dist("auth/seed.js"));
  const dataDir = mkdtempSync(join(tmpdir(), "skillforge-seed-file-"));
  const db = openDatabase(dataDir);
  try {
    migrate(db);
    const file = initialAdminPasswordPath(dataDir);
    writeFileSync(file, "stale\n", { mode: 0o644 });
    seedAdmin(db, dataDir, null);
    const content = readFileSync(file, "utf8").trim();
    assert.notEqual(content, "stale", "the stale password file was not replaced");
    assert.ok(content.length >= 16, "the file has no generated password");
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
