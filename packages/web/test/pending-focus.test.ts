// fix-pending-focus: a control is never `disabled` because a request runs — that drops keyboard focus to the page.
// Use <Button pending={…}> (aria-disabled, aria-busy, a repeated press ignored); inputs use readOnly + aria-disabled.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const PENDING = /\b(isPending|busy|pending|saving|submitting)\b/;

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

test("no control is disabled by a pending request", () => {
  const found: string[] = [];
  for (const file of tsxFiles(SRC)) {
    const text = fs.readFileSync(file, "utf8");
    // Not aria-disabled: that is the fix, and `\b` matches right after its hyphen.
    for (const m of text.matchAll(/(?<![-\w])disabled=\{([^{}]*)\}/g)) {
      if (!PENDING.test(m[1]!)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      found.push(
        `${path.relative(SRC, file).split(path.sep).join("/")}:${line}: disabled={${m[1]!.trim()}}`,
      );
    }
  }
  assert.deepEqual(
    found,
    [],
    `use <Button pending> or readOnly/aria-disabled:\n${found.join("\n")}`,
  );
});
