// ESLint (flat config) does not read `.gitignore`,
// so every git-ignored directory must also be excluded in `eslint.config.js` — otherwise the first JS file
// in `.reckon/`, `.codegraph/`, `test-results/`… would break `npm run lint` or be linted for nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";

const ROOT = join(import.meta.dirname, "..");

/** Directory patterns from .gitignore (`name/`), without negations and comments. */
function gitignoredDirs() {
  return readFileSync(join(ROOT, ".gitignore"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!") && l.endsWith("/"))
    .map((l) => l.replace(/\/$/, ""));
}

test("every directory from .gitignore is excluded in ESLint", async () => {
  const dirs = gitignoredDirs();
  assert.ok(dirs.length >= 8, `too few directories in .gitignore: ${dirs}`);
  const eslint = new ESLint({ cwd: ROOT });
  const notIgnored = [];
  for (const d of dirs) {
    const probe = join(ROOT, ...d.split("/"), "probe.js");
    if (!(await eslint.isPathIgnored(probe))) notIgnored.push(d);
  }
  assert.deepEqual(notIgnored, []);
});
