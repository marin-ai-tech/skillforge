// Acceptance tests: publish.ts split into a
// publish/ module directory with a thin facade, suppressions pruned, behavior preserved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const SRC = join(ROOT, "packages", "server", "src");
const PUB_DIR = join(SRC, "publish");
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

test("publish/ module directory exists with prepare/commit/artifact", () => {
  for (const f of ["prepare.ts", "commit.ts", "artifact.ts", "types.ts"]) {
    assert.ok(existsSync(join(PUB_DIR, f)), `packages/server/src/publish/${f} is missing`);
  }
});

test("submodules export the publish entry points", () => {
  const src = (f) => read(join(PUB_DIR, f));
  assert.match(src("prepare.ts"), /export function preparePublish|export \{[^}]*preparePublish/,
    "prepare.ts does not export preparePublish");
  assert.match(src("commit.ts"), /export function commitPublish|export \{[^}]*commitPublish/,
    "commit.ts does not export commitPublish");
  assert.match(src("artifact.ts"), /export function publishArtifact|export \{[^}]*publishArtifact/,
    "artifact.ts does not export publishArtifact");
});

test("publish.ts is a thin re-export facade", () => {
  const f = join(SRC, "publish.ts");
  assert.ok(existsSync(f), "packages/server/src/publish.ts is missing");
  const text = read(f);
  assert.ok(!/export function (preparePublish|commitPublish|publishArtifact)/.test(text),
    "publish.ts still defines the entry points instead of re-exporting");
  assert.match(text, /export \* from "\.\/publish\//, "publish.ts does not re-export ./publish/*");
});

test("suppressions no longer cover packages/server/src/publish.ts", () => {
  const sup = JSON.parse(read(join(ROOT, "eslint-suppressions.json")));
  assert.ok(!("packages/server/src/publish.ts" in sup),
    "eslint-suppressions.json still suppresses complexity in publish.ts");
});

test("no publish module exceeds the complexity ratchet", () => {
  const sup = JSON.parse(read(join(ROOT, "eslint-suppressions.json")));
  const offenders = readdirSync(PUB_DIR)
    .filter((n) => n.endsWith(".ts"))
    .map((n) => `packages/server/src/publish/${n}`)
    .filter((k) => k in sup);
  assert.deepEqual(offenders, [], `suppressed complexity remains in: ${offenders.join(", ")}`);
});
