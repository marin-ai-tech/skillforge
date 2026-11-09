import type { Database } from "../db.ts";
import type { ArtifactRow } from "../repo.ts";
import { visibleClause } from "../visibility/sql.ts";
import type { Viewer } from "../visibility/index.ts";
import {
  computeCappedTransfer,
  countSessionsInWindow,
  daysToMs,
  isoFromMs,
  lastActivityAt,
  latestAblation,
  loadWindowReports,
  type AblationSignal,
  type LifecyclePolicy,
} from "./policy.ts";

export type OverhangReason = { code: string; text: string };

export type OverhangVerdict = {
  verdict: "overhang" | "healthy" | "unknown";
  ablation: AblationSignal | null;
  usage_window: {
    window_days: number;
    uses: number;
    reporters: number;
    transfer_rate: number | null;
  };
  last_activity_at: string | null;
  reasons: OverhangReason[];
};

const REPORT_LIMIT = 100;

/**
 * A signal detector for "what can be removed", not a transition policy.
 * The zombie/ablationMinTasks thresholds are neither applied nor relaxed:
 * the verdict answers the with/without delta question; statuses are changed by the sweep.
 */
export function computeOverhang(
  db: Database,
  row: Pick<ArtifactRow, "id" | "status" | "latest_version">,
  policy: LifecyclePolicy,
  nowMs: number,
): OverhangVerdict {
  const ablation = latestAblation(db, row.id);
  const windowStart = isoFromMs(nowMs - daysToMs(policy.zombieWindowDays));
  const reports = loadWindowReports(db, row.id, windowStart);
  const transfer = computeCappedTransfer(reports, policy.zombieMinUses, policy.zombieMinReporters);
  const sessions = countSessionsInWindow(db, row.id, windowStart);
  const uses = transfer.uses + sessions.sessions;
  const last_activity_at = lastActivityAt(db, row.id, row.latest_version);

  const reasons: OverhangReason[] = [];
  let verdict: OverhangVerdict["verdict"];
  if (!ablation) {
    verdict = "unknown";
    reasons.push({ code: "no_ablation_data", text: "No ablation evidence recorded" });
  } else if (ablation.uplift <= 0) {
    verdict = "overhang";
    reasons.push({ code: "no_uplift", text: "Latest ablation shows no uplift" });
    if (uses === 0) {
      reasons.push({ code: "zero_usage", text: "No usage in window" });
    }
    if (last_activity_at && last_activity_at < isoFromMs(nowMs - daysToMs(policy.zombieIdleDays))) {
      reasons.push({ code: "idle", text: "No activity beyond idle threshold" });
    }
  } else {
    verdict = "healthy";
    reasons.push({ code: "positive_uplift", text: "Latest ablation shows uplift" });
  }

  return {
    verdict,
    ablation,
    usage_window: {
      window_days: policy.zombieWindowDays,
      uses,
      reporters: transfer.reporters,
      transfer_rate: transfer.rate,
    },
    last_activity_at,
    reasons,
  };
}

export type OverhangReportItem = {
  type: string;
  name: string;
  status: string;
  verdict: "overhang";
  uplift: number;
  tasks: number;
  last_activity_at: string | null;
};

export function listOverhang(
  db: Database,
  viewer: Viewer,
  policy: LifecyclePolicy,
  nowMs: number,
): OverhangReportItem[] {
  const vis = visibleClause(viewer, "artifacts");
  // Candidates are artifacts WITH ablation evidence — not "the N most recently
  // updated": a stale artifact must not be evicted from the report by fresh
  // writes to unrelated rows.
  const rows = db
    .prepare(
      `SELECT DISTINCT artifacts.* FROM artifacts
       JOIN artifact_versions v ON v.artifact_id = artifacts.id
       WHERE artifacts.purged_at IS NULL AND ${vis.sql}
         AND artifacts.status != 'retired'
         AND v.purged_at IS NULL
         AND v.evidence LIKE '%"ablation"%'
       ORDER BY artifacts.updated_at DESC`,
    )
    .all(...vis.params) as ArtifactRow[];

  const items: OverhangReportItem[] = [];
  for (const row of rows) {
    const o = computeOverhang(db, row, policy, nowMs);
    if (o.verdict !== "overhang" || !o.ablation) continue;
    items.push({
      type: row.type,
      name: row.name,
      status: row.status,
      verdict: "overhang",
      uplift: o.ablation.uplift,
      tasks: o.ablation.tasks,
      last_activity_at: o.last_activity_at,
    });
    if (items.length >= REPORT_LIMIT) break;
  }
  items.sort(
    (a, b) =>
      a.uplift - b.uplift || (a.last_activity_at ?? "").localeCompare(b.last_activity_at ?? ""),
  );
  return items;
}
