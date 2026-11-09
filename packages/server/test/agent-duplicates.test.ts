import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyGroup,
  dedupeSnapshotItems,
  pickPrimary,
  rootPriority,
} from "../src/agents/duplicates.ts";
import type { SnapshotItem } from "../src/agents/scan.ts";

function item(root: string, digest: string, key = "skill/x"): SnapshotItem {
  const [type, name] = key.split("/") as [string, string];
  return { key, type, name, digest, files: [], version: null, root };
}

test("rootPriority: .claude/ < no leading dot < .agents/ < other", () => {
  assert.ok(rootPriority(".claude/skills/a") < rootPriority("skills/a"));
  assert.ok(rootPriority("skills/a") < rootPriority(".agents/skills/a"));
  assert.ok(rootPriority(".agents/skills/a") < rootPriority(".cursor/skills/a"));
});

test("pickPrimary: priority, then lexical; backups lose to any non-backup copy", () => {
  assert.equal(
    pickPrimary([item("skills/a", "1"), item(".claude/skills/a", "2")]).root,
    ".claude/skills/a",
  );
  assert.equal(
    pickPrimary([item(".agents/skills/a", "1"), item("skills/a", "2")]).root,
    "skills/a",
  );
  assert.equal(
    pickPrimary([item(".zed/skills/a", "1"), item(".cursor/skills/a", "2")]).root,
    ".cursor/skills/a",
  );
  assert.equal(
    pickPrimary([item(".claude/skills/a.bak", "1"), item(".agents/skills/a", "2")]).root,
    ".agents/skills/a",
  );
  assert.equal(
    pickPrimary([item("skills/a.bak", "1"), item("skills/a.old", "1")]).root,
    "skills/a.bak",
  );
});

test("classifyGroup: replica, divergent, stale_backup wins", () => {
  assert.equal(
    classifyGroup([
      { root: "a", digest: "1" },
      { root: "b", digest: "1" },
    ]),
    "replica",
  );
  assert.equal(
    classifyGroup([
      { root: "a", digest: "1" },
      { root: "b", digest: "2" },
    ]),
    "divergent",
  );
  assert.equal(
    classifyGroup([
      { root: "a", digest: "1" },
      { root: "a.bak", digest: "1" },
    ]),
    "stale_backup",
  );
  assert.equal(
    classifyGroup([
      { root: "a", digest: "1" },
      { root: "a~", digest: "2" },
    ]),
    "stale_backup",
  );
});

test("dedupeSnapshotItems: one item per key, groups sorted by key, roots lexical, reason non-empty", () => {
  const { items, duplicates } = dedupeSnapshotItems([
    item(".agents/skills/b", "1", "skill/b"),
    item(".claude/skills/b", "1", "skill/b"),
    item("skills/a", "2", "skill/a"),
    item(".claude/skills/a", "3", "skill/a"),
    item("commands/c", "4", "command/c"),
  ]);
  assert.deepEqual(items.map((i) => [i.key, i.root]).sort(), [
    ["command/c", "commands/c"],
    ["skill/a", ".claude/skills/a"],
    ["skill/b", ".claude/skills/b"],
  ]);
  assert.deepEqual(
    duplicates.map((g) => [g.key, g.class, g.keep, g.roots.map((r) => r.root)]),
    [
      ["skill/a", "divergent", ".claude/skills/a", [".claude/skills/a", "skills/a"]],
      ["skill/b", "replica", ".claude/skills/b", [".agents/skills/b", ".claude/skills/b"]],
    ],
  );
  for (const g of duplicates) assert.ok(g.reason.length > 0);
  assert.deepEqual(dedupeSnapshotItems([item("skills/a", "1")]).duplicates, []);
});
