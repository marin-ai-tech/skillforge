import { isBackupRoot } from "@skillforge/core";
import type { SnapshotItem } from "./scan.ts";

export type DuplicateClass = "replica" | "divergent" | "stale_backup";

export type DuplicateGroup = {
  key: string;
  class: DuplicateClass;
  roots: Array<{ root: string; digest: string }>;
  keep: string;
  reason: string;
};

/** Lower is better: `.claude/` → no leading dot → `.agents/` → everything else. */
export function rootPriority(root: string): number {
  if (root.startsWith(".claude/")) return 0;
  if (!root.startsWith(".")) return 1;
  if (root.startsWith(".agents/")) return 2;
  return 3;
}

function compareRoots(a: string, b: string): number {
  return rootPriority(a) - rootPriority(b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Picks the copy to keep: a non-backup copy when one exists, then by root priority, then lexically. */
export function pickPrimary<T extends { root: string }>(copies: readonly T[]): T {
  const nonBackup = copies.filter((c) => !isBackupRoot(c.root));
  const pool = nonBackup.length > 0 ? nonBackup : copies;
  return pool.slice().sort((a, b) => compareRoots(a.root, b.root))[0]!;
}

export function classifyGroup(
  copies: ReadonlyArray<{ root: string; digest: string }>,
): DuplicateClass {
  if (copies.some((c) => isBackupRoot(c.root))) return "stale_backup";
  const first = copies[0]?.digest;
  return copies.every((c) => c.digest === first) ? "replica" : "divergent";
}

function describe(cls: DuplicateClass, keep: string, others: string[]): string {
  const list = others.join(", ");
  switch (cls) {
    case "replica":
      return `Identical copies; keep ${keep} (preferred root) and remove ${list}.`;
    case "divergent":
      return `Copies differ; keep ${keep} (preferred root) and review changes in ${list} before removing.`;
    case "stale_backup":
      return `Backup copy detected; keep ${keep} and delete the backup ${list}.`;
  }
}

/**
 * Collapses snapshot items with the same key into one primary item per key and
 * describes each collision as a duplicate group (sorted by key; roots sorted lexically).
 */
export function dedupeSnapshotItems(items: SnapshotItem[]): {
  items: SnapshotItem[];
  duplicates: DuplicateGroup[];
} {
  const byKey = new Map<string, SnapshotItem[]>();
  for (const it of items) {
    const list = byKey.get(it.key);
    if (list) list.push(it);
    else byKey.set(it.key, [it]);
  }

  const out: SnapshotItem[] = [];
  const duplicates: DuplicateGroup[] = [];
  for (const copies of byKey.values()) {
    const keep = pickPrimary(copies);
    out.push(keep);
    if (copies.length < 2) continue;
    const roots = copies
      .map((c) => ({ root: c.root, digest: c.digest }))
      .sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
    const cls = classifyGroup(roots);
    const others = roots.map((r) => r.root).filter((r) => r !== keep.root);
    duplicates.push({
      key: keep.key,
      class: cls,
      roots,
      keep: keep.root,
      reason: describe(cls, keep.root, others),
    });
  }
  duplicates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { items: out, duplicates };
}
