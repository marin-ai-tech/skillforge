// opencode-rules: the textual edit of `instructions` in an OpenCode config — the line is added once, everything else
// (comments, other keys, trailing commas) stays; an unreadable config is refused, not rewritten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonc } from "../src/mcp/jsonc.ts";
import {
  OPENCODE_RULES_GLOB as G,
  planOpencodeInstructions,
} from "../src/runtimes/opencode-config.ts";

const plan = (files: Record<string, string>) =>
  planOpencodeInstructions(Object.entries(files).map(([rel, text]) => ({ rel, text })));
const inst = (text: string) => (parseJsonc(text) as { instructions: unknown }).instructions;

test("no config: a new opencode.json with the line", () => {
  const p = plan({});
  assert.ok(p.ok);
  assert.equal(p.rel, "opencode.json");
  assert.deepEqual(inst(p.text), [G]);
});

test("insertion keeps the file and is idempotent", () => {
  const cases: Array<[string, unknown[]]> = [
    [`{}`, [G]],
    [`{ "mcp": {} }`, [G]],
    [`{\n    // c\n    "a": 1,\n}\n`, [G]],
    [`{ "instructions": [] }`, [G]],
    [`{ "instructions": ["A.md"] }`, ["A.md", G]],
    [`{ "instructions": [\n  "A.md", // why\n  "B.md",\n],\n "x": "]" }`, ["A.md", "B.md", G]],
    [`{ "s": "{[\\"", "instructions": ["A.md" /* c */ ] }`, ["A.md", G]],
  ];
  for (const [text, want] of cases) {
    const p = plan({ "opencode.jsonc": text });
    assert.ok(p.ok && p.changed, text);
    assert.deepEqual(inst(p.text), want, `${text}\n->\n${p.text}`);
    if (text.includes("// c")) assert.ok(p.text.includes("// c"));
    const again = plan({ "opencode.jsonc": p.text });
    assert.ok(again.ok && !again.changed, "second run changes nothing");
  }
});

test("file choice: instructions holder first, then the root config, then .opencode", () => {
  const holder = plan({
    "opencode.json": `{ "a": 1 }`,
    ".opencode/opencode.json": `{ "instructions": [] }`,
  });
  assert.ok(holder.ok && holder.rel === ".opencode/opencode.json");
  const root = plan({ "opencode.json": `{ "a": 1 }`, ".opencode/opencode.jsonc": `{ "b": 1 }` });
  assert.ok(root.ok && root.rel === "opencode.json");
  const dot = plan({ ".opencode/opencode.jsonc": `{ "b": 1 }` });
  assert.ok(dot.ok && dot.rel === ".opencode/opencode.jsonc");
});

test("an unreadable config is refused, naming the file", () => {
  for (const text of [`{ "instructions": [ `, `[1]`, `{ "instructions": "A.md" }`]) {
    const p = plan({ "opencode.json": text });
    assert.equal(p.ok, false, text);
    assert.equal(p.rel, "opencode.json");
  }
});
