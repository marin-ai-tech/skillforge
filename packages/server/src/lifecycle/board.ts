import type { Database } from "../db.ts";
import { rowToSummary, type ArtifactSummary, type ArtifactRow } from "../repo.ts";
import { visibleClause } from "../visibility/sql.ts";
import type { Viewer } from "../visibility/index.ts";
import { roleAtLeast } from "../auth/users.ts";
import {
  allCleanupReasons,
  daysToMs,
  isoFromMs,
  wouldTransition,
  type LifecyclePolicy,
} from "./policy.ts";
import { defaultLifecyclePolicy } from "./policy.ts";

export type CleanupReason = {
  code: string;
  text: string;
  metrics: Record<string, unknown>;
};

export type CleanupItem = {
  type: string;
  name: string;
  status: string;
  since: string;
  reasons: CleanupReason[];
  suggested_action: "review" | "retire";
};

export type LifecycleBoard = {
  review: ArtifactSummary[];
  stale_candidates: ArtifactSummary[];
  aging: ArtifactSummary[];
  zombie: ArtifactSummary[];
  retired_recent: ArtifactSummary[];
  counts: {
    candidate: number;
    active: number;
    aging: number;
    zombie: number;
    retired: number;
  };
  cleanup: CleanupItem[];
};

const LIMIT = 100;

function mapRows(db: Database, rows: ArtifactRow[]): ArtifactSummary[] {
  return rows.map((r) => rowToSummary(db, r));
}

function buildCleanup(
  db: Database,
  viewer: Viewer,
  policy: LifecyclePolicy,
  nowMs: number,
  candidateTtlDays: number,
): CleanupItem[] {
  if (!viewer || !roleAtLeast(viewer.role, "reviewer")) return [];
  const vis = visibleClause(viewer, "artifacts");
  const visible = `artifacts.purged_at IS NULL AND ${vis.sql}`;
  const rows = db
    .prepare(
      `SELECT * FROM artifacts
       WHERE ${visible}
         AND status IN ('zombie', 'aging', 'active', 'candidate')
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(...vis.params, LIMIT * 2) as ArtifactRow[];

  const items: CleanupItem[] = [];
  for (const row of rows) {
    const item = cleanupItemFor(db, row, policy, nowMs, candidateTtlDays);
    if (!item) continue;
    items.push(item);
    if (items.length >= LIMIT) break;
  }
  return items;
}

type TransitionDecision = ReturnType<typeof wouldTransition>;

/** Zombie without live reasons: reuse the rule/metrics recorded on its zombie transition. */
function recordedZombieReasons(db: Database, artifactId: string): CleanupReason[] {
  const ev = db
    .prepare(
      `SELECT reason, meta FROM audit_events
       WHERE artifact_id = ? AND to_status = 'zombie'
       ORDER BY ts DESC, id DESC LIMIT 1`,
    )
    .get(artifactId) as { reason: string | null; meta: string | null } | undefined;
  let code = "idle";
  let metrics: Record<string, unknown> = {};
  if (ev?.meta) {
    try {
      const m = JSON.parse(ev.meta) as { rule?: string; metrics?: Record<string, unknown> };
      if (typeof m.rule === "string") code = m.rule;
      if (m.metrics && typeof m.metrics === "object") metrics = m.metrics;
    } catch {
      /* ignore */
    }
  }
  return [{ code, text: ev?.reason ?? "Marked zombie", metrics }];
}

function includeInCleanup(
  row: ArtifactRow,
  decision: TransitionDecision,
  reasons: CleanupReason[],
): boolean {
  return (
    row.status === "zombie" ||
    (decision !== null && (decision.to === "zombie" || decision.to === "aging")) ||
    (row.status === "candidate" && reasons.some((r) => r.code === "stale_candidate"))
  );
}

/** Prefer the firing rule as first reason for candidates-to-zombie. */
function firingRuleFirst(
  reasons: CleanupReason[],
  decision: NonNullable<TransitionDecision>,
): CleanupReason[] {
  const code = decision.rule;
  if (!reasons.some((r) => r.code === code)) {
    return [{ code, text: decision.reason, metrics: decision.metrics }, ...reasons];
  }
  return [...reasons.filter((r) => r.code === code), ...reasons.filter((r) => r.code !== code)];
}

function suggestedAction(
  row: ArtifactRow,
  policy: LifecyclePolicy,
  nowMs: number,
): "review" | "retire" {
  if (row.status !== "zombie") return "review";
  const retireThreshold = isoFromMs(
    policy.zombieRetireDays <= 0 ? nowMs : nowMs - daysToMs(policy.zombieRetireDays),
  );
  return row.updated_at <= retireThreshold ? "retire" : "review";
}

function cleanupItemFor(
  db: Database,
  row: ArtifactRow,
  policy: LifecyclePolicy,
  nowMs: number,
  candidateTtlDays: number,
): CleanupItem | null {
  let reasons = allCleanupReasons(
    db,
    {
      id: row.id,
      status: row.status,
      latest_version: row.latest_version,
      created_at: row.created_at,
    },
    policy,
    nowMs,
    candidateTtlDays,
  );
  if (row.status === "zombie" && reasons.length === 0) {
    reasons = recordedZombieReasons(db, row.id);
  }
  const decision = wouldTransition(
    db,
    {
      id: row.id,
      status: row.status,
      latest_version: row.latest_version,
      purged_at: row.purged_at,
    },
    policy,
    nowMs,
  );
  if (!includeInCleanup(row, decision, reasons)) return null;
  if (row.status !== "zombie" && decision && decision.to === "zombie") {
    reasons = firingRuleFirst(reasons, decision);
  }
  if (reasons.length === 0) return null;

  return {
    type: row.type,
    name: row.name,
    status: row.status,
    since: row.updated_at,
    reasons,
    suggested_action: suggestedAction(row, policy, nowMs),
  };
}

export function getLifecycleBoard(
  db: Database,
  candidateTtlDays: number,
  viewer: Viewer = null,
  policy: LifecyclePolicy = defaultLifecyclePolicy(),
  nowMs: number = Date.now(),
): LifecycleBoard {
  const vis = visibleClause(viewer, "artifacts");
  const visible = `artifacts.purged_at IS NULL AND ${vis.sql}`;
  const review = mapRows(
    db,
    db
      .prepare(
        `SELECT * FROM artifacts WHERE status = 'candidate' AND ${visible}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...vis.params, LIMIT) as ArtifactRow[],
  );

  const staleThreshold = new Date(
    Date.now() - Math.max(0, candidateTtlDays) * 24 * 60 * 60 * 1000,
  ).toISOString();

  const stale_candidates = mapRows(
    db,
    db
      .prepare(
        `SELECT * FROM artifacts
         WHERE status = 'candidate' AND created_at < ? AND ${visible}
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(staleThreshold, ...vis.params, LIMIT) as ArtifactRow[],
  );

  const aging = mapRows(
    db,
    db
      .prepare(
        `SELECT * FROM artifacts WHERE status = 'aging' AND ${visible}
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...vis.params, LIMIT) as ArtifactRow[],
  );

  const zombie = mapRows(
    db,
    db
      .prepare(
        `SELECT * FROM artifacts WHERE status = 'zombie' AND ${visible}
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...vis.params, LIMIT) as ArtifactRow[],
  );

  const retiredSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const retired_recent = mapRows(
    db,
    db
      .prepare(
        `SELECT * FROM artifacts
         WHERE status = 'retired' AND updated_at >= ? AND ${visible}
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(retiredSince, ...vis.params, LIMIT) as ArtifactRow[],
  );

  const countRows = db
    .prepare(`SELECT status, COUNT(*) AS n FROM artifacts WHERE ${visible} GROUP BY status`)
    .all(...vis.params) as Array<{ status: string; n: number | bigint }>;

  const counts = {
    candidate: 0,
    active: 0,
    aging: 0,
    zombie: 0,
    retired: 0,
  };
  for (const row of countRows) {
    if (row.status in counts) {
      counts[row.status as keyof typeof counts] = Number(row.n);
    }
  }

  const cleanup = buildCleanup(db, viewer, policy, nowMs, candidateTtlDays);

  return { review, stale_candidates, aging, zombie, retired_recent, counts, cleanup };
}
