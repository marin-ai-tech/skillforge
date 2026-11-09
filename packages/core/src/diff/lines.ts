/**
 * Line diff in unified format (version-diff): what a reviewer reads to see what changed between two versions.
 * Longest common subsequence over lines after trimming the common start and end; inputs too large for that return
 * null instead of a slow answer.
 */
type Op = { kind: " " | "-" | "+"; text: string; a: number; b: number };

const MAX_CELLS = 4_000_000;

function lcsOps(a: string[], b: string[], offset: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;
  const w = m + 1;
  const len = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * w + j] =
        a[i] === b[j]
          ? len[(i + 1) * w + j + 1]! + 1
          : Math.max(len[(i + 1) * w + j]!, len[i * w + j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i]!, a: offset + i, b: offset + j });
      i++;
      j++;
    } else if (i < n && (j === m || len[(i + 1) * w + j]! >= len[i * w + j + 1]!)) {
      ops.push({ kind: "-", text: a[i]!, a: offset + i, b: offset + j });
      i++;
    } else {
      ops.push({ kind: "+", text: b[j]!, a: offset + i, b: offset + j });
      j++;
    }
  }
  return ops;
}

function allOps(a: string[], b: string[]): Op[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = lcsOps(a.slice(start, endA), b.slice(start, endB), start);
  if (middle === null) return null;
  const same = (i: number, j: number): Op => ({ kind: " ", text: a[i]!, a: i, b: j });
  const head = Array.from({ length: start }, (_, k) => same(k, k));
  const tail = Array.from({ length: a.length - endA }, (_, k) => same(endA + k, endB + k));
  return [...head, ...middle, ...tail];
}

/** Groups changes with `context` unchanged lines around them into hunks. */
function hunks(ops: Op[], context: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < ops.length) {
    while (i < ops.length && ops[i]!.kind === " ") i++;
    if (i >= ops.length) break;
    const from = Math.max(0, i - context);
    let to = i;
    let quiet = 0;
    while (to < ops.length && quiet <= context * 2) {
      quiet = ops[to]!.kind === " " ? quiet + 1 : 0;
      to++;
    }
    to = Math.min(ops.length, to - Math.max(0, quiet - context));
    const part = ops.slice(from, to);
    const aLen = part.filter((o) => o.kind !== "+").length;
    const bLen = part.filter((o) => o.kind !== "-").length;
    out.push(`@@ -${part[0]!.a + 1},${aLen} +${part[0]!.b + 1},${bLen} @@`);
    for (const o of part) out.push(`${o.kind}${o.text}`);
    i = to;
  }
  return out;
}

/** Unified diff text of two texts; "" when equal, null when too large to compute. */
export function unifiedDiff(before: string, after: string, context = 3): string | null {
  if (before === after) return "";
  const ops = allOps(before.split(/\r?\n/), after.split(/\r?\n/));
  if (ops === null) return null;
  return hunks(ops, context).join("\n");
}
