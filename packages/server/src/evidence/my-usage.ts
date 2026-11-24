import type { Database } from "../db.ts";
import { canView, type Viewer } from "../visibility/index.ts";

/** At most this many artifacts in the cabinet's usage section (my-space-usage). */
export const MY_USAGE_LIMIT = 20;

export type MyUsageItem = {
  type: string;
  name: string;
  reports: number;
  uses: number;
  helped: number;
  not_helped: number;
  basis: { loaded: number; assigned: number; unspecified: number };
  last_version: string | null;
  last_reported_at: string;
};

export type MyUsageSummary = {
  reports: number;
  artifacts: number;
  items: MyUsageItem[];
  more: boolean;
};

type Row = {
  id: string;
  type: string;
  name: string;
  visibility: string;
  owner_team: string | null;
  owner: string;
  reports: number | bigint;
  uses: number | bigint;
  helped: number | bigint;
  loaded: number | bigint;
  assigned: number | bigint;
  unspecified: number | bigint;
  last_reported_at: string;
};

function lastVersion(db: Database, reporter: string, artifactId: string): string | null {
  const row = db
    .prepare(
      `SELECT version FROM artifact_usage_reports
       WHERE reporter = ? AND artifact_id = ?
       ORDER BY reported_at DESC, rowid DESC LIMIT 1`,
    )
    .get(reporter, artifactId) as { version: string | null } | undefined;
  return row?.version ?? null;
}

function toItem(db: Database, reporter: string, r: Row): MyUsageItem {
  const uses = Number(r.uses);
  const helped = Number(r.helped);
  return {
    type: r.type,
    name: r.name,
    reports: Number(r.reports),
    uses,
    helped,
    not_helped: uses - helped,
    basis: {
      loaded: Number(r.loaded),
      assigned: Number(r.assigned),
      unspecified: Number(r.unspecified),
    },
    last_version: lastVersion(db, reporter, r.id),
    last_reported_at: r.last_reported_at,
  };
}

/**
 * The user's own usage reports per artifact (my-space-usage): only artifacts the user can see now, newest report
 * first; totals over every visible artifact. Reports of other people never enter.
 */
export function myUsageSummary(db: Database, viewer: NonNullable<Viewer>): MyUsageSummary {
  const rows = db
    .prepare(
      `SELECT a.id, a.type, a.name, a.visibility, a.owner_team, a.owner,
              COUNT(*) AS reports, SUM(r.uses) AS uses, SUM(r.helped) AS helped,
              SUM(CASE WHEN r.basis = 'loaded' THEN 1 ELSE 0 END) AS loaded,
              SUM(CASE WHEN r.basis = 'assigned' THEN 1 ELSE 0 END) AS assigned,
              SUM(CASE WHEN r.basis IS NULL THEN 1 ELSE 0 END) AS unspecified,
              MAX(r.reported_at) AS last_reported_at
       FROM artifact_usage_reports r
       JOIN artifacts a ON a.id = r.artifact_id
       WHERE r.reporter = ? AND a.purged_at IS NULL
       GROUP BY a.id
       ORDER BY last_reported_at DESC, a.name ASC, a.type ASC`,
    )
    .all(viewer.username) as Row[];
  const visible = rows.filter((r) => canView(db, viewer, { ...r, purged_at: null }));
  return {
    reports: visible.reduce((n, r) => n + Number(r.reports), 0),
    artifacts: visible.length,
    items: visible.slice(0, MY_USAGE_LIMIT).map((r) => toItem(db, viewer.username, r)),
    more: visible.length > MY_USAGE_LIMIT,
  };
}
