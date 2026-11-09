import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertRealPathsInside, isInsideRoot, relativeInside } from "../src/bundle.ts";
import { pruneEmptyDirs } from "../src/lock.ts";
import { resolveTarget } from "../src/runtime.ts";

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

test("relativeInside: component-wise containment, sibling prefix is outside", () => {
  const root = path.resolve("/a/skills");
  assert.equal(relativeInside(root, root), "");
  assert.equal(relativeInside(root, path.join(root, "x", "y")), path.join("x", "y"));
  assert.equal(relativeInside(root, path.resolve("/a/skills-old")), null);
  assert.equal(relativeInside(root, path.resolve("/a")), null);
  assert.equal(isInsideRoot(root, path.resolve("/a/skills/..x")), true);
});

test("pruneEmptyDirs stops at the root and never climbs into a prefix sibling", () => {
  const dir = tmp("sf-prune-");
  const root = path.join(dir, "skills");
  const sibling = path.join(dir, "skills-old");
  fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
  fs.mkdirSync(sibling);
  pruneEmptyDirs(path.join(root, "a", "b", "f.md"), root);
  assert.ok(fs.existsSync(root), "root kept");
  assert.ok(!fs.existsSync(path.join(root, "a")), "empty dirs removed");
  pruneEmptyDirs(path.join(sibling, "f.md"), root);
  assert.ok(fs.existsSync(sibling), "outside the root is untouched");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("assertRealPathsInside rejects a target behind a symlinked directory, accepts a symlinked base", () => {
  const dir = tmp("sf-real-");
  const outside = path.join(dir, "outside");
  const base = path.join(dir, "proj", ".agents");
  fs.mkdirSync(outside);
  fs.mkdirSync(base, { recursive: true });
  fs.symlinkSync(outside, path.join(base, "skills"), "junction");
  assert.throws(
    () => assertRealPathsInside(base, [path.join(base, "skills", "x", "SKILL.md")]),
    /outside/,
  );
  assert.doesNotThrow(() => assertRealPathsInside(base, [path.join(base, "commands", "c.md")]));

  const linkedBase = path.join(dir, "linked");
  fs.symlinkSync(base, linkedBase, "junction");
  assert.doesNotThrow(() =>
    assertRealPathsInside(linkedBase, [path.join(linkedBase, "commands", "c.md")]),
  );
  assert.throws(() => assertRealPathsInside(base, [path.join(dir, "elsewhere.md")]));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolveTarget: default .claude, runtime dirs, --into conflicts, unknown runtime lists ids", () => {
  assert.equal(resolveTarget({}).base, path.resolve(".claude"));
  assert.equal(resolveTarget({}).runtime?.id, "claude-code");
  assert.equal(resolveTarget({ runtime: "codex" }).base, path.resolve(".codex"));
  assert.equal(
    resolveTarget({ runtime: "opencode", scope: "user" }).base,
    path.join(os.homedir(), ".config", "opencode"),
  );
  const into = resolveTarget({ into: "custom" });
  assert.equal(into.base, path.resolve("custom"));
  assert.equal(into.runtime, null);
  assert.throws(() => resolveTarget({ into: "x", runtime: "codex" }), /--into/);
  assert.throws(() => resolveTarget({ into: "x", scope: "user" }), /--into/);
  assert.throws(
    () => resolveTarget({ runtime: "vim" }),
    /claude-code, codex, gemini, cursor, opencode, qwen, devin, reckon/,
  );
  for (const id of ["devin", "reckon"] as const)
    assert.throws(
      () => resolveTarget({ runtime: id, scope: "user" }),
      new RegExp(`not supported by ${id}`),
    );
  assert.throws(() => resolveTarget({ scope: "global" }), /scope/);
});
