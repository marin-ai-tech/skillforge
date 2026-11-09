import type { Database } from "../db.ts";
import { transitionArtifact } from "./transitions.ts";
import {
  defaultLifecyclePolicy,
  policyFromConfig,
  wouldTransition,
  type LifecyclePolicy,
  type TransitionDecision,
} from "./policy.ts";
import { getActiveHold } from "./holds.ts";

export type SweepPlanItem = {
  type: string;
  name: string;
  from: string;
  to: string;
  rule: string;
  metrics: Record<string, unknown>;
};

export type SweepResult = {
  aged: number;
  zombied: number;
  revived: number;
  held: number;
  deferred: number;
  dry_run: boolean;
  plan: SweepPlanItem[];
};

export type SweepOptions = {
  dry_run?: boolean;
  nowMs?: number;
};

type ArtifactCand = {
  id: string;
  type: string;
  name: string;
  status: string;
  latest_version: string | null;
  purged_at: string | null;
};

function resolvePolicy(policyOrDays: LifecyclePolicy | number): LifecyclePolicy {
  if (typeof policyOrDays === "number") {
    return defaultLifecyclePolicy(policyOrDays);
  }
  return policyOrDays;
}

/** Age / zombie / revive by data policy. Automatic transitions only via transitionArtifact. */
export function runAgingSweep(
  db: Database,
  policyOrDays: LifecyclePolicy | number,
  options: SweepOptions = {},
): SweepResult {
  const policy = resolvePolicy(policyOrDays);
  const dry_run = options.dry_run === true;
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const rows = db
    .prepare(
      `SELECT id, type, name, status, latest_version, purged_at
       FROM artifacts
       WHERE purged_at IS NULL
         AND status IN ('active', 'aging')
         AND latest_version IS NOT NULL
       ORDER BY type ASC, name ASC`,
    )
    .all() as ArtifactCand[];

  const decided: Array<{ row: ArtifactCand; decision: TransitionDecision }> = [];
  let held = 0;

  for (const row of rows) {
    const decision = wouldTransition(db, row, policy, nowMs);
    if (!decision) continue;
    const activeHold = getActiveHold(db, row.id, nowIso);
    if (activeHold) {
      held += 1;
      continue;
    }
    decided.push({ row, decision });
  }

  const planRows = decided.slice(0, policy.maxPerSweep);
  const deferred = decided.length - planRows.length;
  const plan: SweepPlanItem[] = planRows.map(({ row, decision }) => ({
    type: row.type,
    name: row.name,
    from: row.status,
    to: decision.to,
    rule: decision.rule,
    metrics: decision.metrics,
  }));

  let aged = 0;
  let zombied = 0;
  let revived = 0;
  for (const item of plan) {
    if (item.to === "aging") aged += 1;
    else if (item.to === "zombie") zombied += 1;
    else if (item.to === "active") revived += 1;
  }

  if (!dry_run) {
    for (const { row, decision } of planRows) {
      transitionArtifact(db, {
        type: row.type,
        name: row.name,
        to: decision.to,
        reason: decision.reason,
        actor: "system",
        actorRole: "system",
        meta: decision.meta,
      });
    }
  }

  return { aged, zombied, revived, held, deferred, dry_run, plan };
}

export { policyFromConfig };
