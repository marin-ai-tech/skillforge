import { RUNTIMES, isRuntimeId, type RuntimeId } from "@skillforge/core";
import type { Database } from "../repo.ts";
import { sharedModels } from "./model.ts";

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
  model: string | null;
  session_key: string;
  reporter: string;
  used_at: string;
  verification: string;
};

type Acc = {
  runtime: RuntimeId | null;
  model: string | null;
  sessions: Set<string>;
  users: Set<string>;
  last: string | null;
  counts: { pass: number; fail: number; none: number };
};

/** session-fact-model: one row per agent and model; a model one person reported joins the agent's `null` row. */
export type ModelMetricsRow = RuntimeMetricsRow & { model: string | null };

const ORDER = new Map<string, number>(RUNTIMES.map((r, i) => [r.id, i]));
const LABEL = new Map<string, string>(RUNTIMES.map((r) => [r.id, r.label]));

const runtimeOf = (source: string): RuntimeId | null => (isRuntimeId(source) ? source : null);

/** Facts grouped by agent, and by model too when `shownModels` is given (others fall into the agent's null row). */
function accumulate(rows: readonly FactRow[], shownModels: Set<string> | null): Acc[] {
  const acc = new Map<string, Acc>();
  for (const f of rows) {
    const runtime = runtimeOf(f.source);
    const model = shownModels && f.model !== null && shownModels.has(f.model) ? f.model : null;
    const key = `${runtime ?? ""}|${shownModels ? (model ?? "") : ""}`;
    let a = acc.get(key);
    if (!a) {
      a = {
        runtime,
        model,
        sessions: new Set(),
        users: new Set(),
        last: null,
        counts: { pass: 0, fail: 0, none: 0 },
      };
      acc.set(key, a);
    }
    a.sessions.add(f.session_key);
    a.users.add(f.reporter);
    if (a.last === null || f.used_at > a.last) a.last = f.used_at;
    if (f.verification === "pass" || f.verification === "fail" || f.verification === "none") {
      a.counts[f.verification]++;
    }
  }
  return [...acc.values()];
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

function toRow(a: Acc, artifactUsers: number): RuntimeMetricsRow {
  return {
    runtime: a.runtime,
    label: a.runtime === null ? null : (LABEL.get(a.runtime) ?? null),
    sessions_count: a.sessions.size,
    users_count: a.users.size,
    last_used_at: a.last,
    verification: shares(a, artifactUsers),
  };
}

/** Agents by sessions (ties in table order), the "other" row always last. */
function compareRows(a: RuntimeMetricsRow, b: RuntimeMetricsRow): number {
  if (a.runtime === null) return b.runtime === null ? 0 : 1;
  if (b.runtime === null) return -1;
  if (a.sessions_count !== b.sessions_count) return b.sessions_count - a.sessions_count;
  return (ORDER.get(a.runtime) ?? 0) - (ORDER.get(b.runtime) ?? 0);
}

function factRows(db: Database, artifactId: string): FactRow[] {
  return db
    .prepare(
      "SELECT source, model, session_key, reporter, used_at, verification FROM session_facts WHERE artifact_id = ?",
    )
    .all(artifactId) as FactRow[];
}

export function metricsByRuntime(
  db: Database,
  artifactId: string,
  artifactUsers: number,
): RuntimeMetricsRow[] {
  return accumulate(factRows(db, artifactId), null)
    .map((a) => toRow(a, artifactUsers))
    .sort(compareRows);
}

/**
 * Rows by agent and model, agents in the order of `metricsByRuntime`, models by sessions, the agent's `null` row last.
 * Empty when no row names a model: then the table would only repeat the agents.
 */
export function metricsByModel(
  db: Database,
  artifactId: string,
  artifactUsers: number,
): ModelMetricsRow[] {
  const facts = factRows(db, artifactId);
  const groups = accumulate(facts, sharedModels(db));
  if (!groups.some((g) => g.model !== null)) return [];
  const agentOrder = new Map(
    metricsByRuntime(db, artifactId, artifactUsers).map((r, i) => [r.runtime ?? "", i]),
  );
  const rank = (g: Acc) => agentOrder.get(g.runtime ?? "") ?? 0;
  return groups
    .sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if ((a.model === null) !== (b.model === null)) return a.model === null ? 1 : -1;
      return b.sessions.size - a.sessions.size;
    })
    .map((g) => ({ ...toRow(g, artifactUsers), model: g.model }));
}
