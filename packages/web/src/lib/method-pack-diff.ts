import type { PackVersion } from "../api/types.ts";

/** One difference between two method pack versions (pack-authoring), by role and item. */
export type MethodPackChange =
  | { kind: "role_added"; role: string }
  | { kind: "role_removed"; role: string }
  | { kind: "item_added"; role: string; item: string }
  | { kind: "item_removed"; role: string; item: string }
  | { kind: "item_changed"; role: string; item: string; from: string; to: string };

type Items = Map<string, string>;

function itemsOf(role: PackVersion["roles"][number]): Items {
  return new Map(role.items.map((i) => [`${i.type}/${i.name}`, i.version]));
}

function roleChanges(role: string, a: Items, b: Items): MethodPackChange[] {
  const out: MethodPackChange[] = [];
  for (const [item, to] of b) {
    const from = a.get(item);
    if (from === undefined) out.push({ kind: "item_added", role, item });
    else if (from !== to) out.push({ kind: "item_changed", role, item, from, to });
  }
  for (const item of a.keys()) if (!b.has(item)) out.push({ kind: "item_removed", role, item });
  return out;
}

/** What changed from `a` to `b`: roles added and removed, items added, removed and moved to another version. */
export function diffMethodPackVersions(a: PackVersion, b: PackVersion): MethodPackChange[] {
  const before = new Map(a.roles.map((r) => [r.name, r]));
  const after = new Map(b.roles.map((r) => [r.name, r]));
  const out: MethodPackChange[] = [];
  for (const [name, role] of after) {
    const old = before.get(name);
    if (!old) out.push({ kind: "role_added", role: name });
    else out.push(...roleChanges(name, itemsOf(old), itemsOf(role)));
  }
  for (const name of before.keys())
    if (!after.has(name)) out.push({ kind: "role_removed", role: name });
  return out;
}

const LINE_RE = /^([a-z]+)\/([a-z0-9]+(?:-[a-z0-9]+)*)@(\S+)$/;

/** Items from the form's text: one `type/name@version` per line; blank lines are skipped. */
export function parseItemLines(text: string): {
  items: Array<{ type: string; name: string; version: string }>;
  badLine: number | null;
} {
  const items: Array<{ type: string; name: string; version: string }> = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) return { items, badLine: i + 1 };
    items.push({ type: m[1]!, name: m[2]!, version: m[3]! });
  }
  return { items, badLine: null };
}

export function itemLines(items: Array<{ type: string; name: string; version: string }>): string {
  return items.map((i) => `${i.type}/${i.name}@${i.version}`).join("\n");
}

/** The next patch version: 1.1.0 → 1.1.1; anything else is left for the author. */
export function nextPatch(version: string | null | undefined): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : "";
}
