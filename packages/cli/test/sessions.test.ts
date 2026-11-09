// Acceptance tests: the session parser's
// directory walk keeps a visited-realpath set, so a symlink to an ancestor or sibling
// inside the root does not produce a second traversal or a duplicate file.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeCodeAdapter } from "../src/sessions/claude-code.ts";

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function symlinkJunction(target: string, link: string): void {
  try {
    fs.symlinkSync(target, link, "junction");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EPERM") test.skip("symlinks not permitted");
    else throw err;
  }
}

test("findFiles: symlink to ancestor inside root does not re-walk the tree", () => {
  const root = tmp("sf-sessions-");
  fs.mkdirSync(path.join(root, "a"));
  fs.writeFileSync(path.join(root, "a", "x.jsonl"), "{}\n");
  symlinkJunction(root, path.join(root, "loop"));

  const found = claudeCodeAdapter.findFiles(root).map((f) => fs.realpathSync(f));
  const x = fs.realpathSync(path.join(root, "a", "x.jsonl"));
  assert.equal(
    found.filter((f) => f === x).length,
    1,
    `x.jsonl listed ${found.filter((f) => f === x).length} times: ${found.join(", ")}`,
  );
});

test("findFiles: symlink to sibling directory lists each file once", () => {
  const root = tmp("sf-sessions-");
  fs.mkdirSync(path.join(root, "a"));
  fs.writeFileSync(path.join(root, "a", "x.jsonl"), "{}\n");
  symlinkJunction(path.join(root, "a"), path.join(root, "twin"));

  const found = claudeCodeAdapter.findFiles(root).map((f) => fs.realpathSync(f));
  assert.equal(found.length, 1, `expected exactly one entry: ${found.join(", ")}`);
});

test("findFiles: symlink outside root is still ignored", () => {
  const root = tmp("sf-sessions-");
  const outside = tmp("sf-sessions-out-");
  fs.writeFileSync(path.join(outside, "evil.jsonl"), "{}\n");
  fs.writeFileSync(path.join(root, "ok.jsonl"), "{}\n");
  symlinkJunction(outside, path.join(root, "escape"));

  const found = claudeCodeAdapter.findFiles(root).map((f) => path.basename(f));
  assert.deepEqual(found, ["ok.jsonl"]);
});
