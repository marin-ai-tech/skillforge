// Acceptance tests: the web fallback list of types is a single one, equal to the core types; pages do not
// keep their own copies. Requires the core to be built.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/client.mjs";

const LIST = join(ROOT, "packages/web/src/lib/artifact-types.ts");
const PAGES = ["Home.tsx", "Browse.tsx", "Metrics.tsx", "Publish.tsx"].map((p) => join(ROOT, "packages/web/src/pages", p));

test("FALLBACK_TYPE_IDS equals the ARTIFACT_TYPES ids of the core", async () => {
  const core = await import(pathToFileURL(join(ROOT, "packages/core/dist/index.js")).href);
  const coreIds = core.ARTIFACT_TYPES.map((t) => t.id);
  assert.ok(existsSync(LIST), "no packages/web/src/lib/artifact-types.ts");
  const m = /FALLBACK_TYPE_IDS\s*=\s*\[([^\]]*)\]/.exec(readFileSync(LIST, "utf8"));
  assert.ok(m, "no FALLBACK_TYPE_IDS = [...]");
  const webIds = [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]);
  assert.deepEqual(webIds, coreIds);
});

test("api/types.ts does not list types by hand", () => {
  const types = readFileSync(join(ROOT, "packages/web/src/api/types.ts"), "utf8");
  assert.doesNotMatch(types, /"skill"\s*\|\s*"command"/);
  assert.match(readFileSync(LIST, "utf8"), /export type ArtifactType/);
});

test("pages do not keep their own copies of the type list and use the shared one", () => {
  for (const page of PAGES) {
    const src = readFileSync(page, "utf8");
    assert.doesNotMatch(src, /\[\s*"skill",\s*"command"|\{ id: "skill", label: "skill" \}/, `${page}: an inline type list`);
    assert.match(src, /FALLBACK_TYPE_IDS/, `${page}: does not use FALLBACK_TYPE_IDS`);
  }
});
