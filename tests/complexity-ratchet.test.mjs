// Complexity ratchet: violations of the complexity threshold 15 are cut away package by package.
// Each following cut adds its package here. Behavior does not change — existing tests prove that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const suppressions = JSON.parse(readFileSync(join(ROOT, "eslint-suppressions.json"), "utf8"));
const countUnder = (prefix) =>
  Object.entries(suppressions)
    .filter(([file]) => file.startsWith(prefix))
    .reduce((n, [, rules]) => n + Object.values(rules).reduce((m, r) => m + r.count, 0), 0);

// Cut packages: no entries must remain in the ratchet for them.
for (const pkg of ["packages/cli/src/", "packages/core/src/", "packages/server/src/", "packages/web/src/", "plugins/"]) {
  test(`complexity ratchet: ${pkg} has no suppressed violations`, () => {
    assert.equal(countUnder(pkg), 0, `violations left in eslint-suppressions.json for ${pkg}: ${countUnder(pkg)}`);
  });
}

test("the complexity ratchet only decreases: total 0 (fully cleared)", () => {
  assert.ok(countUnder("") === 0, `total ${countUnder("")}`);
});
