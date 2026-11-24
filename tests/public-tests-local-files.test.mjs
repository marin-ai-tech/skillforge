// Release 0.6.0 lesson: the public tree (GitHub) has no second-language files (the `local` list of
// scripts/publish-manifest.json: topics-ru, i18n/ru, docs/ru, …), and the release workflow there runs the public tests.
// Two tests read RU help without checking it exists and stopped the release on GitHub, after every internal run was
// green. A public test that names a local path must check it exists (existsSync) or be listed as local itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./lib/client.mjs";

const MANIFEST = JSON.parse(readFileSync(join(ROOT, "scripts", "publish-manifest.json"), "utf8"));
const NOT_PUBLIC = [...MANIFEST.internal, ...MANIFEST.local];
const isNotPublic = (rel) => NOT_PUBLIC.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));
/** Local paths as a test would name them in code: `topics-ru`, `docs/ru`, `i18n/ru`, `locales/ru`. */
const LOCAL_NAMES = [/topics-ru/, /docs[/\\"', ]+ru\b/, /i18n[/\\"', ]+ru\b/, /locales[/\\"', ]+ru/];

function testFiles() {
  const dirs = [join(ROOT, "tests"), ...["cli", "core", "server", "web"].map((p) => join(ROOT, "packages", p, "test"))];
  return dirs.flatMap((d) =>
    readdirSync(d, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && /\.(mjs|ts)$/.test(e.name))
      .map((e) => join(e.parentPath ?? e.path, e.name)),
  );
}

test("a public test that reads second-language files checks that they exist", () => {
  const offenders = [];
  let checked = 0;
  for (const file of testFiles()) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (isNotPublic(rel)) continue;
    checked++;
    const text = readFileSync(file, "utf8");
    if (LOCAL_NAMES.some((re) => re.test(text)) && !/existsSync/.test(text)) offenders.push(rel);
  }
  assert.ok(checked > 100, `only ${checked} public test files found`);
  assert.deepEqual(offenders, [], "guard the local files with existsSync, or list the test as local in publish-manifest.json");
});
