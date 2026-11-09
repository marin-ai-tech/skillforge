// CLI `--version`: the CLI version must be printed together with global flags, as JSON with `--json`,
// while `publish --version <v>` still means the artifact version.
// Requires `npm run build`. No server needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const VERSION = JSON.parse(readFileSync(join(ROOT, "packages", "cli", "package.json"), "utf8")).version;

function cli(args) {
  const work = mkdtempSync(join(tmpdir(), "skillforge-cli-version-"));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: work,
      env: { ...process.env, SKILLFORGE_CONFIG: join(work, "config.json"), NO_COLOR: "1", SKILLFORGE_URL: undefined, SKILLFORGE_TOKEN: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 15000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      rmSync(work, { recursive: true, force: true });
      resolve({ code, stdout, stderr });
    });
  });
}

test("the built CLI exists", () => {
  assert.ok(existsSync(CLI), `${CLI} is missing — run npm run build`);
});

test("--version and -V alone print the version (regression)", async () => {
  for (const flag of ["--version", "-V"]) {
    const r = await cli([flag]);
    assert.equal(r.code, 0, `${flag}: ${r.stderr}`);
    assert.equal(r.stdout.trim(), VERSION);
  }
});

test("--version together with global flags in any order", async () => {
  for (const args of [
    ["--no-color", "--version"],
    ["--version", "--no-color"],
    ["-V", "--no-color"],
    ["--url", "http://127.0.0.1:1", "--version"],
  ]) {
    const r = await cli(args);
    assert.equal(r.code, 0, `${args.join(" ")}: code ${r.code}, stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), VERSION, `${args.join(" ")}: ${r.stdout}`);
  }
});

test("--version --json prints JSON { version }", async () => {
  for (const args of [["--version", "--json"], ["--json", "--version"], ["--json", "-V"]]) {
    const r = await cli(args);
    assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout), { version: VERSION }, `${args.join(" ")}: ${r.stdout}`);
  }
});

test("publish --version <v> stays the artifact version flag, not the CLI version", async () => {
  const help = await cli(["publish", "--help"]);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /--version <version>/);
  // Without a registry, publish must reach the registry check (code 3), not print the CLI version.
  const r = await cli(["publish", join(ROOT, "tests", "fixtures", "artifacts", "skill-standard", "pdf-tools"), "--type", "skill", "--version", "9.9.9"]);
  assert.equal(r.code, 3, `expected code 3 (no registry): ${r.code} ${r.stdout} ${r.stderr}`);
  assert.ok(!r.stdout.trim().startsWith(VERSION) || r.stdout.includes("SKILLFORGE_URL"), r.stdout);
  assert.ok(r.stderr.includes("SKILLFORGE_URL"), r.stderr);
});
