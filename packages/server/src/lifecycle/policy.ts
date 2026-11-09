import type { Database } from "../db.ts";

export type LifecyclePolicy = {
  dataLifecycleEnabled: boolean;
  agingDays: number;
  zombieIdleDays: number;
  zombieWindowDays: number;
  zombieMinUses: number;
  zombieMinReporters: number;
  zombieTransferRate: number;
  zombieRetireDays: number;
  ablationMinTasks: number;
  reviveWindowDays: number;
  reviveMinEvents: number;
  maxPerSweep: number;
};

export type AblationSignal = {
  tasks: number;
  passed_with: number;
  passed_without: number;
  uplift: number;
  at: string | null;
  by: string | null;
};

export type LifecycleSignals = {
  last_activity_at: string | null;
  window_days: number;
  uses_window: number;
  reporters_window: number;
  transfer_rate_window: number | null;
  sessions_window: number;
  verification_pass_rate: number | null;
  ablation: AblationSignal | null;
};

export type TransitionDecision = {
  to: "aging" | "zombie" | "active";
  rule: string;
  metrics: Record<string, unknown>;
  reason: string;
  meta: Record<string, unknown>;
};

export type WindowTransfer = {
  uses: number;
  helped: number;
  reporters: number;
  rate: number | null;
  applies: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysToMs(days: number): number {
  return days * DAY_MS;
}

export function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

/** Same age boundary as board.stale_candidates (created_at vs candidateTtlDays). */
export function isStaleCandidate(
  createdAt: string,
  candidateTtlDays: number,
  nowMs: number,
): boolean {
  const ttl = Math.max(0, candidateTtlDays);
  const threshold = isoFromMs(nowMs - daysToMs(ttl));
  return createdAt < threshold;
}

/** Cap per-author contribution then sum. Order: cap -> sum -> compare MIN_USES -> rate. */
export function computeCappedTransfer(
  reports: Array<{ reporter: string; uses: number; helped: number }>,
  minUses: number,
  minReporters: number,
): WindowTransfer {
  const byAuthor = new Map<string, { uses: number; helped: number }>();
  for (const r of reports) {
    const cur = byAuthor.get(r.reporter) ?? { uses: 0, helped: 0 };
    cur.uses += r.uses;
    cur.helped += r.helped;
    byAuthor.set(r.reporter, cur);
  }
  const reporters = byAuthor.size;
  let uses = 0;
  let helped = 0;
  for (const agg of byAuthor.values()) {
    if (agg.uses <= 0) continue;
    const cappedUses = Math.min(agg.uses, minUses);
    const cappedHelped = (agg.helped * cappedUses) / agg.uses;
    uses += cappedUses;
    helped += cappedHelped;
  }
  const applies = reporters >= minReporters && uses >= minUses;
  const rate = uses > 0 ? Math.round((helped / uses) * 1000) / 1000 : null;
  return { uses, helped, reporters, rate, applies };
}

export function lastActivityAt(
  db: Database,
  artifactId: string,
  latestVersion: string | null,
): string | null {
  let max: string | null = null;
  const bump = (v: string | null | undefined) => {
    if (!v) return;
    if (max === null || v > max) max = v;
  };
  if (latestVersion) {
    const ver = db
      .prepare(
        `SELECT COALESCE(validated_at, published_at) AS t
         FROM artifact_versions
         WHERE artifact_id = ? AND version = ? AND purged_at IS NULL`,
      )
      .get(artifactId, latestVersion) as { t: string | null } | undefined;
    bump(ver?.t ?? null);
  }
  const sess = db
    .prepare("SELECT MAX(used_at) AS t FROM session_facts WHERE artifact_id = ?")
    .get(artifactId) as { t: string | null } | undefined;
  bump(sess?.t ?? null);
  const usage = db
    .prepare("SELECT MAX(reported_at) AS t FROM artifact_usage_reports WHERE artifact_id = ?")
    .get(artifactId) as { t: string | null } | undefined;
  bump(usage?.t ?? null);
  return max;
}

export function validationActivityAt(
  db: Database,
  artifactId: string,
  latestVersion: string | null,
): string | null {
  if (!latestVersion) return null;
  const ver = db
    .prepare(
      `SELECT COALESCE(validated_at, published_at) AS t
       FROM artifact_versions
       WHERE artifact_id = ? AND version = ? AND purged_at IS NULL`,
    )
    .get(artifactId, latestVersion) as { t: string | null } | undefined;
  return ver?.t ?? null;
}

export function loadWindowReports(
  db: Database,
  artifactId: string,
  windowStartIso: string,
): Array<{ reporter: string; uses: number; helped: number }> {
  return db
    .prepare(
      `SELECT reporter, uses, helped FROM artifact_usage_reports
       WHERE artifact_id = ? AND reported_at >= ?`,
    )
    .all(artifactId, windowStartIso) as Array<{ reporter: string; uses: number; helped: number }>;
}

export function countSessionsInWindow(
  db: Database,
  artifactId: string,
  windowStartIso: string,
): { sessions: number; pass: number; fail: number } {
  const sessions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM session_facts
       WHERE artifact_id = ? AND used_at >= ?`,
    )
    .get(artifactId, windowStartIso) as { n: number | bigint };
  const counts = db
    .prepare(
      `SELECT verification, COUNT(*) AS n FROM session_facts
       WHERE artifact_id = ? AND used_at >= ?
       GROUP BY verification`,
    )
    .all(artifactId, windowStartIso) as Array<{ verification: string; n: number | bigint }>;
  let pass = 0;
  let fail = 0;
  for (const c of counts) {
    if (c.verification === "pass") pass = Number(c.n);
    else if (c.verification === "fail") fail = Number(c.n);
  }
  return { sessions: Number(sessions.n), pass, fail };
}

export function countUsageEventsInWindow(
  db: Database,
  artifactId: string,
  windowStartIso: string,
): number {
  const sessions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM session_facts
       WHERE artifact_id = ? AND used_at >= ?`,
    )
    .get(artifactId, windowStartIso) as { n: number | bigint };
  const reports = db
    .prepare(
      `SELECT COUNT(*) AS n FROM artifact_usage_reports
       WHERE artifact_id = ? AND reported_at >= ?`,
    )
    .get(artifactId, windowStartIso) as { n: number | bigint };
  return Number(sessions.n) + Number(reports.n);
}

export function latestAblation(db: Database, artifactId: string): AblationSignal | null {
  const rows = db
    .prepare(
      `SELECT evidence FROM artifact_versions
       WHERE artifact_id = ? AND purged_at IS NULL`,
    )
    .all(artifactId) as Array<{ evidence: string }>;
  let best: AblationSignal | null = null;
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.evidence);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const e of parsed) {
      const signal = ablationSignalFromEntry(e);
      if (!signal) continue;
      if (supersedes(best, signal.at)) best = signal;
    }
  }
  return best;
}

/** Stored evidence entry → ablation signal; null for non-ablation or malformed entries. */
function ablationSignalFromEntry(e: unknown): AblationSignal | null {
  if (!e || typeof e !== "object") return null;
  const r = e as Record<string, unknown>;
  if (r.kind !== "ablation" || !r.data || typeof r.data !== "object") return null;
  const d = r.data as Record<string, unknown>;
  return {
    tasks: Number(d.tasks),
    passed_with: Number(d.passed_with),
    passed_without: Number(d.passed_without),
    uplift: Number(d.uplift),
    at: typeof r.at === "string" ? r.at : null,
    by: typeof r.by === "string" ? r.by : null,
  };
}

/** A signal replaces the current best when there is none, or it is dated and not older. */
function supersedes(best: AblationSignal | null, at: string | null): boolean {
  return !best || (!!at && (!best.at || at >= best.at));
}

export function ablationFromEvidenceList(
  evidence: Array<{
    kind: string;
    at: string | null;
    by: string | null;
    data?: Record<string, unknown> | null;
  }>,
): AblationSignal | null {
  let best: AblationSignal | null = null;
  for (const e of evidence) {
    if (e.kind !== "ablation" || !e.data) continue;
    const at = e.at;
    const signal: AblationSignal = {
      tasks: Number(e.data.tasks),
      passed_with: Number(e.data.passed_with),
      passed_without: Number(e.data.passed_without),
      uplift: Number(e.data.uplift),
      at,
      by: e.by,
    };
    if (!best || !best.at || (at && at >= best.at)) best = signal;
  }
  return best;
}

export function collectSignals(
  db: Database,
  artifactId: string,
  latestVersion: string | null,
  policy: LifecyclePolicy,
  nowMs: number,
): LifecycleSignals {
  const windowStart = isoFromMs(nowMs - daysToMs(policy.zombieWindowDays));
  const reports = loadWindowReports(db, artifactId, windowStart);
  const transfer = computeCappedTransfer(reports, policy.zombieMinUses, policy.zombieMinReporters);
  const sess = countSessionsInWindow(db, artifactId, windowStart);
  const denom = sess.pass + sess.fail;
  const verification_pass_rate = denom === 0 ? null : Math.round((sess.pass / denom) * 1000) / 1000;
  const last = policy.dataLifecycleEnabled
    ? lastActivityAt(db, artifactId, latestVersion)
    : validationActivityAt(db, artifactId, latestVersion);
  return {
    last_activity_at: last,
    window_days: policy.zombieWindowDays,
    uses_window: transfer.uses,
    reporters_window: transfer.reporters,
    transfer_rate_window: transfer.rate,
    sessions_window: sess.sessions,
    verification_pass_rate,
    ablation: latestAblation(db, artifactId),
  };
}

export function evaluateZombieRule(
  status: string,
  signals: LifecycleSignals,
  policy: LifecyclePolicy,
  nowMs: number,
): TransitionDecision | null {
  if (!policy.dataLifecycleEnabled) return null;
  if (status !== "active" && status !== "aging") return null;

  if (status === "aging") {
    const thresholdMs =
      policy.zombieIdleDays <= 0 ? nowMs : nowMs - daysToMs(policy.zombieIdleDays);
    const threshold = isoFromMs(thresholdMs);
    if (signals.last_activity_at !== null && signals.last_activity_at < threshold) {
      return {
        to: "zombie",
        rule: "idle",
        metrics: { last_activity_at: signals.last_activity_at },
        reason: "zombie policy: idle",
        meta: {
          rule: "idle",
          metrics: { last_activity_at: signals.last_activity_at },
          window_days: policy.zombieIdleDays,
        },
      };
    }
  }

  if (
    signals.reporters_window >= policy.zombieMinReporters &&
    signals.uses_window >= policy.zombieMinUses &&
    signals.transfer_rate_window !== null &&
    signals.transfer_rate_window < policy.zombieTransferRate
  ) {
    return {
      to: "zombie",
      rule: "low_transfer",
      metrics: {
        uses: signals.uses_window,
        reporters: signals.reporters_window,
        transfer_rate: signals.transfer_rate_window,
      },
      reason: "zombie policy: low_transfer",
      meta: {
        rule: "low_transfer",
        metrics: {
          uses: signals.uses_window,
          reporters: signals.reporters_window,
          transfer_rate: signals.transfer_rate_window,
        },
        window_days: policy.zombieWindowDays,
      },
    };
  }

  const ab = signals.ablation;
  if (ab && ab.tasks >= policy.ablationMinTasks && ab.uplift <= 0) {
    return {
      to: "zombie",
      rule: "no_ablation_uplift",
      metrics: {
        tasks: ab.tasks,
        uplift: ab.uplift,
        passed_with: ab.passed_with,
        passed_without: ab.passed_without,
      },
      reason: "zombie policy: no_ablation_uplift",
      meta: {
        rule: "no_ablation_uplift",
        metrics: {
          tasks: ab.tasks,
          uplift: ab.uplift,
          passed_with: ab.passed_with,
          passed_without: ab.passed_without,
        },
        window_days: policy.zombieWindowDays,
      },
    };
  }

  return null;
}

export function evaluateRevive(
  status: string,
  db: Database,
  artifactId: string,
  policy: LifecyclePolicy,
  nowMs: number,
): TransitionDecision | null {
  if (!policy.dataLifecycleEnabled) return null;
  if (status !== "aging") return null;
  const windowStart = isoFromMs(nowMs - daysToMs(policy.reviveWindowDays));
  const events = countUsageEventsInWindow(db, artifactId, windowStart);
  if (events >= policy.reviveMinEvents) {
    return {
      to: "active",
      rule: "revived_by_usage",
      metrics: { events, window_days: policy.reviveWindowDays },
      reason: "revived by usage",
      meta: { rule: "revived_by_usage", metrics: { events }, window_days: policy.reviveWindowDays },
    };
  }
  return null;
}

export function evaluateAging(
  status: string,
  policy: LifecyclePolicy,
  nowMs: number,
  activityAt: string | null,
): TransitionDecision | null {
  if (status !== "active") return null;
  const thresholdMs = policy.agingDays <= 0 ? nowMs : nowMs - daysToMs(policy.agingDays);
  const threshold = isoFromMs(thresholdMs);
  if (activityAt !== null && activityAt < threshold) {
    return {
      to: "aging",
      rule: "idle_active",
      metrics: { last_activity_at: activityAt },
      reason: "aging policy",
      meta: { rule: "idle_active", last_activity_at: activityAt },
    };
  }
  return null;
}

/** What automation would do now (ignores hold). Priority: revive > zombie > aging. */
export function wouldTransition(
  db: Database,
  artifact: { id: string; status: string; latest_version: string | null; purged_at: string | null },
  policy: LifecyclePolicy,
  nowMs: number,
): TransitionDecision | null {
  if (artifact.purged_at) return null;
  if (
    artifact.status === "candidate" ||
    artifact.status === "retired" ||
    artifact.status === "zombie"
  ) {
    return null;
  }
  const signals = collectSignals(db, artifact.id, artifact.latest_version, policy, nowMs);
  const revive = evaluateRevive(artifact.status, db, artifact.id, policy, nowMs);
  if (revive) return revive;
  const zombie = evaluateZombieRule(artifact.status, signals, policy, nowMs);
  if (zombie) return zombie;
  const activity = policy.dataLifecycleEnabled
    ? signals.last_activity_at
    : validationActivityAt(db, artifact.id, artifact.latest_version);
  return evaluateAging(artifact.status, policy, nowMs, activity);
}

export function allCleanupReasons(
  db: Database,
  artifact: { id: string; status: string; latest_version: string | null; created_at: string },
  policy: LifecyclePolicy,
  nowMs: number,
  candidateTtlDays: number,
): Array<{ code: string; text: string; metrics: Record<string, unknown> }> {
  const signals = collectSignals(db, artifact.id, artifact.latest_version, policy, nowMs);
  const reasons: Array<{ code: string; text: string; metrics: Record<string, unknown> }> = [];

  // idle reason only while aging (matches zombie rule); zombies use data rules / audit
  if (artifact.status === "aging") {
    const thresholdMs =
      policy.zombieIdleDays <= 0 ? nowMs : nowMs - daysToMs(policy.zombieIdleDays);
    const threshold = isoFromMs(thresholdMs);
    if (signals.last_activity_at !== null && signals.last_activity_at < threshold) {
      reasons.push({
        code: "idle",
        text: "No activity within idle threshold",
        metrics: { last_activity_at: signals.last_activity_at },
      });
    }
  }

  if (
    signals.reporters_window >= policy.zombieMinReporters &&
    signals.uses_window >= policy.zombieMinUses &&
    signals.transfer_rate_window !== null &&
    signals.transfer_rate_window < policy.zombieTransferRate
  ) {
    reasons.push({
      code: "low_transfer",
      text: "Robust transfer rate below threshold",
      metrics: {
        uses: signals.uses_window,
        reporters: signals.reporters_window,
        transfer_rate: signals.transfer_rate_window,
      },
    });
  }

  const ab = signals.ablation;
  if (ab && ab.tasks >= policy.ablationMinTasks && ab.uplift <= 0) {
    reasons.push({
      code: "no_ablation_uplift",
      text: "Latest ablation shows no uplift",
      metrics: { tasks: ab.tasks, uplift: ab.uplift },
    });
  }

  // stale_candidate: only candidates older than TTL (same created_at boundary as board.stale_candidates)
  if (
    artifact.status === "candidate" &&
    isStaleCandidate(artifact.created_at, candidateTtlDays, nowMs)
  ) {
    reasons.push({
      code: "stale_candidate",
      text: "Candidate awaiting review",
      metrics: { created_at: artifact.created_at, candidate_ttl_days: candidateTtlDays },
    });
  }

  return reasons;
}

export function policyFromConfig(config: {
  agingDays: number;
  dataLifecycleEnabled: boolean;
  zombieIdleDays: number;
  zombieWindowDays: number;
  zombieMinUses: number;
  zombieMinReporters: number;
  zombieTransferRate: number;
  zombieRetireDays: number;
  ablationMinTasks: number;
  reviveWindowDays: number;
  reviveMinEvents: number;
  lifecycleMaxPerSweep: number;
}): LifecyclePolicy {
  return {
    dataLifecycleEnabled: config.dataLifecycleEnabled,
    agingDays: config.agingDays,
    zombieIdleDays: config.zombieIdleDays,
    zombieWindowDays: config.zombieWindowDays,
    zombieMinUses: config.zombieMinUses,
    zombieMinReporters: config.zombieMinReporters,
    zombieTransferRate: config.zombieTransferRate,
    zombieRetireDays: config.zombieRetireDays,
    ablationMinTasks: config.ablationMinTasks,
    reviveWindowDays: config.reviveWindowDays,
    reviveMinEvents: config.reviveMinEvents,
    maxPerSweep: config.lifecycleMaxPerSweep,
  };
}

export function defaultLifecyclePolicy(agingDays = 90): LifecyclePolicy {
  return {
    dataLifecycleEnabled: true,
    agingDays,
    zombieIdleDays: 180,
    zombieWindowDays: 60,
    zombieMinUses: 20,
    zombieMinReporters: 3,
    zombieTransferRate: 0.2,
    zombieRetireDays: 30,
    ablationMinTasks: 10,
    reviveWindowDays: 14,
    reviveMinEvents: 3,
    maxPerSweep: 20,
  };
}
