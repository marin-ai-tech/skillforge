// The CLI speaks English, and one error has one text.
// The `not_owner` refusal must read the same in the early and the late 403 check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "packages", "cli", "src");

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** Source without comments, keeping string literals (comments may be in any language). */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

test("no Cyrillic in CLI strings", () => {
  const bad = [];
  for (const f of files(SRC)) {
    withoutComments(readFileSync(f, "utf8"))
      .split("\n")
      .forEach((line, i) => {
        if (/[\u0400-\u04FF]/.test(line)) bad.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
  }
  assert.deepEqual(bad, []);
});

test("the not_owner refusal text is written once in the CLI (both 403 branches use it)", () => {
  const all = files(SRC).map((f) => readFileSync(f, "utf8")).join("\n");
  const hits = all.match(/ask the owner to add you as a maintainer/g) ?? [];
  assert.equal(hits.length, 1, `found ${hits.length}`);
});
