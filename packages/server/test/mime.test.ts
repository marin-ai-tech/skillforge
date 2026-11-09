import { test } from "node:test";
import assert from "node:assert/strict";
import { contentTypeForPath } from "../src/mime.ts";

test("contentTypeForPath mappings", () => {
  assert.equal(contentTypeForPath("a/b/SKILL.md"), "text/markdown; charset=utf-8");
  assert.equal(contentTypeForPath("hooks/hooks.json"), "application/json");
  assert.equal(contentTypeForPath("scripts/guard.sh"), "text/plain; charset=utf-8");
  assert.equal(contentTypeForPath("notes.txt"), "text/plain; charset=utf-8");
  assert.equal(contentTypeForPath("x.py"), "text/plain; charset=utf-8");
  assert.equal(contentTypeForPath("x.js"), "text/plain; charset=utf-8");
  assert.equal(contentTypeForPath("x.ts"), "text/plain; charset=utf-8");
  assert.equal(contentTypeForPath("bin/data.bin"), "application/octet-stream");
});
