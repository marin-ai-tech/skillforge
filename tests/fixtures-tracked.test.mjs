// Test-system audit: the fixture
// tests/fixtures/imports/plugin-sample/node_modules/junk/index.js existed only in a local working copy —
// it was hidden by `.gitignore` (`node_modules/`), so the scanner test in packages/core was green locally and red
// on any clean clone. This test catches the whole class: no file under tests/fixtures may be ignored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/client.mjs";

test("no files under tests/fixtures are hidden by .gitignore (a fixture must reach the repository)", () => {
  const r = spawnSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--", "tests/fixtures"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const ignored = r.stdout.split(/\r?\n/).filter(Boolean);
  assert.deepEqual(ignored, [], `these fixtures are ignored by git and will not reach a clean clone:\n${ignored.join("\n")}`);
});

test("the fixture with node_modules that the scanner test depends on is tracked by git", () => {
  const r = spawnSync("git", ["ls-files", "--error-unmatch", "tests/fixtures/imports/plugin-sample/node_modules/junk/index.js"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `the fixture is not committed: ${r.stderr}`);
});
