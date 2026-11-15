import { RUNTIMES, isRuntimeId, type RuntimeId } from "@skillforge/core";
import type { Database } from "../repo.ts";

/**
 * metrics-by-runtime: session facts of an artifact split by the agent they were imported from. `source` is sent by the
 * client, so only a runtime id of the runtime table names an agent; every other source is one "other" row and the
 * string itself never leaves the server. A row of one user hides its verification shares when the artifact has more
 * users: the shares would be that person's.
 */
export type RuntimeVerification = {
  pass: number;
  fail: number;
  none: number;
  pass_rate: number | null;
};

export type RuntimeMetricsRow = {
  runtime: RuntimeId | null;
  label: string | null;
  sessions_count: number;
  users_count: number;
  last_used_at: string | null;
  verification: RuntimeVerification | null;
};

type FactRow = {
  source: string;
  session_key: string;
  reporter: string;
  used_at: string;
  verification: string;
};

type Acc = {
  sessions: Set<string>;
  users: Set<string>;
  last: string | null;
  counts: { pass: number; fail: number; none: number };
};

const ORDER = new Map<string, number>(RUNTIMES.map((r, i) => [r.id, i]));
const LABEL = new Map<string, string>(RUNTIMES.map((r) => [r.id, r.label]));

function blank(): Acc {
  return {
    sessions: new Set(),
    users: new Set(),
    last: null,
    counts: { pass: 0, fail: 0, none: 0 },
  };
}

function accumulate(rows: readonly FactRow[]): Map<RuntimeId | null, Acc> {
  const acc = new Map<RuntimeId | null, Acc>();
  for (const f of rows) {
    const key = isRuntimeId(f.source) ? f.source : null;
    const a = acc.get(key) ?? blank();
    acc.set(key, a);
    a.sessions.add(f.session_key);
    a.users.add(f.reporter);
    if (a.last === null || f.used_at > a.last) a.last = f.used_at;
    if (f.verification === "pass" || f.verification === "fail" || f.verification === "none") {
      a.counts[f.verification]++;
    }
  }
  return acc;
}

function shares(a: Acc, artifactUsers: number): RuntimeVerification | null {
  if (a.users.size === 1 && artifactUsers > 1) return null;
  const { pass, fail, none } = a.counts;
  const denom = pass + fail;
  return {
    pass,
    fail,
    none,
    pass_rate: denom === 0 ? null : Math.round((pass / denom) * 1000) / 1000,
  };
}

/** Agents by sessions (ties in table order), the "other" row always last. */
function compareRows(a: RuntimeMetricsRow, b: RuntimeMetricsRow): number {
  if (a.runtime === null) return 1;
  if (b.runtime === null) return -1;
  if (a.sessions_count !== b.sessions_count) return b.sessions_count - a.sessions_count;
  return (ORDER.get(a.runtime) ?? 0) - (ORDER.get(b.runtime) ?? 0);
}

export function metricsByRuntime(
  db: Database,
  artifactId: string,
  artifactUsers: number,
): RuntimeMetricsRow[] {
  const rows = db
    .prepare(
      "SELECT source, session_key, reporter, used_at, verification FROM session_facts WHERE artifact_id = ?",
    )
    .all(artifactId) as FactRow[];
  const out: RuntimeMetricsRow[] = [];
  for (const [runtime, a] of accumulate(rows)) {
    out.push({
      runtime,
      label: runtime === null ? null : (LABEL.get(runtime) ?? null),
      sessions_count: a.sessions.size,
      users_count: a.users.size,
      last_used_at: a.last,
      verification: shares(a, artifactUsers),
    });
  }
  return out.sort(compareRows);
}
