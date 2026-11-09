// An arrow in Audit.tsx became «?» after a save in the wrong encoding and stayed for
// a month — nothing looked at character integrity of UI sources. Close the class: no U+FFFD, no UTF-8-as-Latin-1
// mojibake, and no «?» standing between two JSX expressions in markup text (`} ? {` — inside code a ternary is wrapped
// in braces, so this sequence only occurs in JSX text).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./lib/client.mjs";

const SRC = join(ROOT, "packages", "web", "src");

function* sources(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.(tsx?|css|html|md)$/.test(e.name)) yield p;
  }
}

const RULES = [
  { name: "U+FFFD replacement character", re: /�/ },
  { name: "UTF-8 read as Latin-1 (â€ / Ã)", re: /â€|Ã[\u0080-¿]/ },
  { name: "«?» between JSX expressions", re: /\}\s\?\s\{/, only: /\.tsx$/ },
];

test("UI sources contain no garbled characters", () => {
  const hits = [];
  for (const file of sources(SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const rule of RULES) {
      if (rule.only && !rule.only.test(file)) continue;
      lines.forEach((line, i) => {
        if (rule.re.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1} (${rule.name}): ${line.trim().slice(0, 90)}`);
      });
    }
  }
  assert.deepEqual(hits, [], `garbled characters:\n${hits.join("\n")}`);
});
