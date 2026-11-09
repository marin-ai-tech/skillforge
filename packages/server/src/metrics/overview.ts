import { isArtifactType } from "@skillforge/core";
import type { Database } from "../repo.ts";
import { isStatus } from "../lifecycle/machine.ts";
import { visibleClause } from "../visibility/sql.ts";
import type { Viewer } from "../visibility/index.ts";
import {
  ablationReportsFromEvidenceJson,
  ablationScore,
  medianTokenCost,
  tokenCostFromFilesJson,
  tokenEfficiency,
  transferRate,
} from "./compute.ts";

export const SORT_FIELDS = [
  "name",
  "status",
  "skill_age_days",
  "sessions_count",
  "verification_pass_rate",
  "transfer_rate",
  "ablation_score",
  "token_efficiency",
  "last_used_at",
] as const;

export type SortField = (typeof SORT_FIELDS)[number];

export const EXPORT_COLUMNS = [
  "type",
  "name",
  "display_name",
  "status",
  "owner_team",
  "latest_version",
  "skill_age_days",
  "sessions_count",
  "users_count",
  "last_used_at",
  "verification_pass_rate",
  "uses",
  "transfer_rate",
  "ablation_score",
  "token_cost",
  "token_efficiency",
] as const;

export type MetricsRow = {
  type: string;
  name: string;
  display_name: string | null;
  status: string;
  owner_team: string | null;
  latest_version: string | null;
  skill_age_days: number;
  sessions_count: number;
  users_count: number;
  last_used_at: string | null;
  verification_pass_rate: number | null;
  uses: number;
  transfer_rate: number | null;
  ablation_score: number | null;
  token_cost: number;
  token_efficiency: number | null;
};

export type MetricsTotals = {
  artifacts: number;
  by_status: Record<string, number>;
  uses: number;
  helped: number;
  transfer_rate: number | null;
  sessions: number;
  with_ablation: number;
  ablation_mean: number | null;
  median_token_cost: number | null;
};

export type MetricsOverview = {
  totals: MetricsTotals;
  items: MetricsRow[];
  next_offset: number | null;
};

export type MetricsQuery = {
  type?: string;
  status?: string;
  team?: string;
  q?: string;
  sort: SortField;
  order: "asc" | "desc";
  limit: number;
  offset: number;
  /** When true, ignore limit/offset and return up to maxRows (export). */
  exportAll?: boolean;
  maxRows?: number;
};

export type ParseQueryResult =
  { ok: true; query: MetricsQuery } | { ok: false; error: "sort_invalid" | "query_invalid" };

function escapeLike(q: string): string {
  return q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function isSortField(v: string): v is SortField {
  return (SORT_FIELDS as readonly string[]).includes(v);
}

function parseSortParam(sortRaw: string | undefined): SortField | null {
  if (sortRaw !== undefined && sortRaw !== "" && !isSortField(sortRaw)) return null;
  return sortRaw && isSortField(sortRaw) ? sortRaw : "transfer_rate";
}

function parseOrderParam(orderRaw: string | undefined): "asc" | "desc" | null {
  if (orderRaw === undefined || orderRaw === "") return "desc";
  if (orderRaw !== "asc" && orderRaw !== "desc") return null;
  return orderRaw;
}

/** Absent/empty value or one accepted by `valid`. */
function emptyOrValid(value: string | undefined, valid: (v: string) => boolean): boolean {
  return value === undefined || value === "" || valid(value);
}

function parsePaging(raw: Record<string, string | undefined>): {
  limit: number;
  offset: number;
} | null {
  let limit = 50;
  let offset = 0;
  if (raw.limit !== undefined && raw.limit !== "") {
    if (!/^\d+$/.test(raw.limit)) return null;
    limit = Number(raw.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return null;
  }
  if (raw.offset !== undefined && raw.offset !== "") {
    if (!/^\d+$/.test(raw.offset)) return null;
    offset = Number(raw.offset);
    if (!Number.isInteger(offset) || offset < 0) return null;
  }
  return { limit, offset };
}

/**
 * Whitelist parse of overview/export query params.
 * Export callers pass exportAll and omit limit/offset validation when absent.
 */
export function parseMetricsQuery(
  raw: Record<string, string | undefined>,
  opts: { exportAll?: boolean } = {},
): ParseQueryResult {
  const sort = parseSortParam(raw.sort);
  if (sort === null) return { ok: false, error: "sort_invalid" };

  const order = parseOrderParam(raw.order);
  if (order === null) return { ok: false, error: "query_invalid" };

  const type = raw.type;
  if (!emptyOrValid(type, isArtifactType)) return { ok: false, error: "query_invalid" };

  const status = raw.status;
  if (!emptyOrValid(status, isStatus)) return { ok: false, error: "query_invalid" };

  const team = raw.team !== undefined && raw.team !== "" ? raw.team : undefined;

  const q = raw.q;
  if (!emptyOrValid(q, (v) => v.length <= 64)) return { ok: false, error: "query_invalid" };

  const paging = opts.exportAll ? { limit: 50, offset: 0 } : parsePaging(raw);
  if (!paging) return { ok: false, error: "query_invalid" };

  return {
    ok: true,
    query: {
      type: type || undefined,
      status: status || undefined,
      team,
      q: q || undefined,
      sort,
      order,
      limit: paging.limit,
      offset: paging.offset,
      exportAll: opts.exportAll,
      maxRows: opts.exportAll ? 5000 : undefined,
    },
  };
}

type BaseRow = {
  id: string;
  type: string;
  name: string;
  display_name: string | null;
  status: string;
  owner_team: string | null;
  latest_version: string | null;
  description: string;
  created_at: string;
};

type SessionAgg = {
  sessions_count: number;
  users_count: number;
  last_used_at: string | null;
  pass: number;
  fail: number;
};

type UsageAgg = { uses: number; helped: number };

function cmpNullable(
  a: number | string | null,
  b: number | string | null,
  order: "asc" | "desc",
): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls last
  if (bNull) return -1;
  if (a! < b!) return order === "asc" ? -1 : 1;
  if (a! > b!) return order === "asc" ? 1 : -1;
  return 0;
}

function sortValue(row: MetricsRow, sort: SortField): number | string | null {
  switch (sort) {
    case "name":
      return row.name;
    case "status":
      return row.status;
    case "skill_age_days":
      return row.skill_age_days;
    case "sessions_count":
      return row.sessions_count;
    case "verification_pass_rate":
      return row.verification_pass_rate;
    case "transfer_rate":
      return row.transfer_rate;
    case "ablation_score":
      return row.ablation_score;
    case "token_efficiency":
      return row.token_efficiency;
    case "last_used_at":
      return row.last_used_at;
  }
}

type OverviewFilter = { whereSql: string; params: Array<string | number> };

/** WHERE clause (visibility, not purged, query filters) shared by base rows and aggregates. */
function overviewFilter(viewer: Viewer, query: MetricsQuery): OverviewFilter {
  const vis = visibleClause(viewer, "artifacts");
  const where: string[] = [vis.sql, "artifacts.purged_at IS NULL"];
  const params: Array<string | number> = [...vis.params];

  if (query.type) {
    where.push("artifacts.type = ?");
    params.push(query.type);
  }
  if (query.status) {
    where.push("artifacts.status = ?");
    params.push(query.status);
  } else {
    where.push("artifacts.status <> 'retired'");
  }
  if (query.team) {
    where.push("artifacts.owner_team = ?");
    params.push(query.team);
  }
  if (query.q) {
    const like = `%${escapeLike(query.q)}%`;
    where.push(
      "(artifacts.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR artifacts.description LIKE ? ESCAPE '\\' COLLATE NOCASE)",
    );
    params.push(like, like);
  }

  return { whereSql: where.join(" AND "), params };
}

function emptyOverview(): MetricsOverview {
  return {
    totals: {
      artifacts: 0,
      by_status: {},
      uses: 0,
      helped: 0,
      transfer_rate: null,
      sessions: 0,
      with_ablation: 0,
      ablation_mean: null,
      median_token_cost: null,
    },
    items: [],
    next_offset: null,
  };
}

type Aggregates = {
  sessions: Map<string, SessionAgg>;
  usage: Map<string, UsageAgg>;
  ablation: Map<string, ReturnType<typeof ablationReportsFromEvidenceJson>>;
  files: Map<string, string>;
  firstAt: Map<string, string | null>;
};

/** 1) Session aggregates GROUP BY artifact_id */
function loadSessionAggs(
  db: Database,
  idsSql: string,
  params: Array<string | number>,
): Map<string, SessionAgg> {
  const sessionRows = db
    .prepare(
      `SELECT artifact_id,
              COUNT(DISTINCT session_key) AS sessions_count,
              COUNT(DISTINCT reporter) AS users_count,
              MAX(used_at) AS last_used_at,
              SUM(CASE WHEN verification = 'pass' THEN 1 ELSE 0 END) AS pass,
              SUM(CASE WHEN verification = 'fail' THEN 1 ELSE 0 END) AS fail
       FROM session_facts
       WHERE artifact_id IN (${idsSql})
       GROUP BY artifact_id`,
    )
    .all(...params) as Array<{
    artifact_id: string;
    sessions_count: number | bigint;
    users_count: number | bigint;
    last_used_at: string | null;
    pass: number | bigint;
    fail: number | bigint;
  }>;
  const sessions = new Map<string, SessionAgg>();
  for (const r of sessionRows) {
    sessions.set(r.artifact_id, {
      sessions_count: Number(r.sessions_count),
      users_count: Number(r.users_count),
      last_used_at: r.last_used_at,
      pass: Number(r.pass),
      fail: Number(r.fail),
    });
  }
  return sessions;
}

/** 2) Usage counters GROUP BY artifact_id (sum over versions) */
function loadUsageAggs(
  db: Database,
  idsSql: string,
  params: Array<string | number>,
): Map<string, UsageAgg> {
  const usageRows = db
    .prepare(
      `SELECT artifact_id,
              COALESCE(SUM(use_count), 0) AS uses,
              COALESCE(SUM(help_count), 0) AS helped
       FROM artifact_versions
       WHERE artifact_id IN (${idsSql})
       GROUP BY artifact_id`,
    )
    .all(...params) as Array<{
    artifact_id: string;
    uses: number | bigint;
    helped: number | bigint;
  }>;
  const usage = new Map<string, UsageAgg>();
  for (const r of usageRows) {
    usage.set(r.artifact_id, { uses: Number(r.uses), helped: Number(r.helped) });
  }
  return usage;
}

/** 3) Ablation: all evidence JSON for versions of filtered artifacts */
function loadAblationReports(
  db: Database,
  idsSql: string,
  params: Array<string | number>,
): Aggregates["ablation"] {
  const evidenceRows = db
    .prepare(
      `SELECT artifact_id, evidence FROM artifact_versions
       WHERE artifact_id IN (${idsSql})`,
    )
    .all(...params) as Array<{ artifact_id: string; evidence: string }>;
  const ablationByArtifact = new Map<string, ReturnType<typeof ablationReportsFromEvidenceJson>>();
  for (const r of evidenceRows) {
    const list = ablationByArtifact.get(r.artifact_id) ?? [];
    list.push(...ablationReportsFromEvidenceJson(r.evidence));
    ablationByArtifact.set(r.artifact_id, list);
  }
  return ablationByArtifact;
}

/** 4) Latest non-purged version files for token_cost */
function loadLatestFiles(
  db: Database,
  idsSql: string,
  params: Array<string | number>,
  baseRows: BaseRow[],
): Map<string, string> {
  const fileRows = db
    .prepare(
      `SELECT a.id AS artifact_id, v.files AS files
       FROM artifacts a
       JOIN artifact_versions v
         ON v.artifact_id = a.id AND v.version = a.latest_version AND v.purged_at IS NULL
       WHERE a.id IN (${idsSql})`,
    )
    .all(...params) as Array<{ artifact_id: string; files: string }>;
  const filesByArtifact = new Map<string, string>();
  for (const r of fileRows) filesByArtifact.set(r.artifact_id, r.files);

  // Fallback: latest by published_at when latest_version row purged/missing
  const hasMissingFiles = baseRows.some((r) => !filesByArtifact.has(r.id));
  if (hasMissingFiles) {
    const fallback = db
      .prepare(
        `SELECT artifact_id, files FROM artifact_versions
         WHERE artifact_id IN (${idsSql}) AND purged_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM artifacts a
           JOIN artifact_versions lv
             ON lv.artifact_id = a.id AND lv.version = a.latest_version AND lv.purged_at IS NULL
           WHERE a.id = artifact_versions.artifact_id
         )
         AND published_at = (
           SELECT MAX(v2.published_at) FROM artifact_versions v2
           WHERE v2.artifact_id = artifact_versions.artifact_id AND v2.purged_at IS NULL
         )`,
      )
      .all(...params) as Array<{ artifact_id: string; files: string }>;
    for (const r of fallback) filesByArtifact.set(r.artifact_id, r.files);
  }
  return filesByArtifact;
}

/** First published_at for skill_age_days (batch) */
function loadFirstPublished(
  db: Database,
  idsSql: string,
  params: Array<string | number>,
): Map<string, string | null> {
  const ageRows = db
    .prepare(
      `SELECT artifact_id, MIN(published_at) AS first_at
       FROM artifact_versions
       WHERE artifact_id IN (${idsSql}) AND purged_at IS NULL
       GROUP BY artifact_id`,
    )
    .all(...params) as Array<{ artifact_id: string; first_at: string | null }>;
  const firstAt = new Map<string, string | null>();
  for (const r of ageRows) firstAt.set(r.artifact_id, r.first_at);
  return firstAt;
}

function loadAggregates(
  db: Database,
  idsSql: string,
  params: Array<string | number>,
  baseRows: BaseRow[],
): Aggregates {
  const sessions = loadSessionAggs(db, idsSql, params);
  const usage = loadUsageAggs(db, idsSql, params);
  const ablation = loadAblationReports(db, idsSql, params);
  const files = loadLatestFiles(db, idsSql, params, baseRows);
  const firstAt = loadFirstPublished(db, idsSql, params);
  return { sessions, usage, ablation, files, firstAt };
}

function skillAgeDays(first: string | null | undefined, nowMs: number): number {
  let age = 0;
  if (first) {
    const t = Date.parse(first);
    if (Number.isFinite(t)) {
      age = Math.floor((nowMs - t) / 86400000);
      if (age < 0) age = 0;
    }
  }
  return age;
}

function sessionView(
  sess: SessionAgg | undefined,
): Pick<MetricsRow, "sessions_count" | "users_count" | "last_used_at" | "verification_pass_rate"> {
  const pass = sess?.pass ?? 0;
  const fail = sess?.fail ?? 0;
  const denom = pass + fail;
  const passRate = denom === 0 ? null : Math.round((pass / denom) * 1000) / 1000;
  return {
    sessions_count: sess?.sessions_count ?? 0,
    users_count: sess?.users_count ?? 0,
    last_used_at: sess?.last_used_at ?? null,
    verification_pass_rate: passRate,
  };
}

function metricsRowFor(
  b: BaseRow,
  aggs: Aggregates,
  nowMs: number,
): { row: MetricsRow; helped: number } {
  const use = aggs.usage.get(b.id) ?? { uses: 0, helped: 0 };
  const reports = aggs.ablation.get(b.id) ?? [];
  const score = ablationScore(reports);
  const filesJson = aggs.files.get(b.id) ?? "[]";
  const cost = tokenCostFromFilesJson(filesJson);
  const rate = transferRate(use.uses, use.helped);
  const eff = tokenEfficiency(rate, cost);
  const sess = sessionView(aggs.sessions.get(b.id));
  const row: MetricsRow = {
    type: b.type,
    name: b.name,
    display_name: b.display_name,
    status: b.status,
    owner_team: b.owner_team,
    latest_version: b.latest_version,
    skill_age_days: skillAgeDays(aggs.firstAt.get(b.id), nowMs),
    sessions_count: sess.sessions_count,
    users_count: sess.users_count,
    last_used_at: sess.last_used_at,
    verification_pass_rate: sess.verification_pass_rate,
    uses: use.uses,
    transfer_rate: rate,
    ablation_score: score,
    token_cost: cost,
    token_efficiency: eff,
  };
  return { row, helped: use.helped };
}

function ablationMean(uplifts: number[]): number | null {
  if (uplifts.length === 0) return null;
  return Math.round((uplifts.reduce((s, x) => s + x, 0) / uplifts.length) * 1000) / 1000;
}

function overviewPage(
  rows: MetricsRow[],
  totals: MetricsTotals,
  query: MetricsQuery,
): MetricsOverview {
  if (query.exportAll) {
    const max = query.maxRows ?? 5000;
    return {
      totals,
      items: rows.slice(0, max),
      next_offset: null,
    };
  }

  const page = rows.slice(query.offset, query.offset + query.limit);
  const next = query.offset + query.limit < rows.length ? query.offset + query.limit : null;

  return { totals, items: page, next_offset: next };
}

/**
 * Build metrics board/export rows.
 * Visibility and purged exclusion are applied in SQL (visibleClause).
 * Aggregates use a fixed set of GROUP BY queries - not N+1 per artifact.
 */
export function metricsOverview(
  db: Database,
  viewer: Viewer,
  query: MetricsQuery,
  now = new Date(),
): MetricsOverview {
  const { whereSql, params } = overviewFilter(viewer, query);
  const baseRows = db
    .prepare(
      `SELECT artifacts.id, artifacts.type, artifacts.name, artifacts.display_name,
              artifacts.status, artifacts.owner_team, artifacts.latest_version,
              artifacts.description, artifacts.created_at
       FROM artifacts
       WHERE ${whereSql}`,
    )
    .all(...params) as BaseRow[];

  if (baseRows.length === 0) {
    return emptyOverview();
  }

  // Aggregates are scoped by a subquery with the same condition as baseRows (bound with the same params),
  // so the number of SQL parameters does not grow with the registry size (SQLite variable limit).
  const idsSql = `SELECT artifacts.id FROM artifacts WHERE ${whereSql}`;
  const aggs = loadAggregates(db, idsSql, params, baseRows);

  const nowMs = now.getTime();
  const rows: MetricsRow[] = [];
  let totalUses = 0;
  let totalHelped = 0;
  let totalSessions = 0;
  const byStatus: Record<string, number> = {};
  const ablationUplifts: number[] = [];
  const tokenCosts: number[] = [];

  for (const b of baseRows) {
    const { row, helped } = metricsRowFor(b, aggs, nowMs);
    rows.push(row);
    totalUses += row.uses;
    totalHelped += helped;
    totalSessions += row.sessions_count;
    byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
    if (row.ablation_score !== null) ablationUplifts.push(row.ablation_score);
    tokenCosts.push(row.token_cost);
  }

  rows.sort((a, b) => {
    const primary = cmpNullable(sortValue(a, query.sort), sortValue(b, query.sort), query.order);
    if (primary !== 0) return primary;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  const totals: MetricsTotals = {
    artifacts: rows.length,
    by_status: byStatus,
    uses: totalUses,
    helped: totalHelped,
    transfer_rate: transferRate(totalUses, totalHelped),
    sessions: totalSessions,
    with_ablation: ablationUplifts.length,
    ablation_mean: ablationMean(ablationUplifts),
    median_token_cost: medianTokenCost(tokenCosts),
  };

  return overviewPage(rows, totals, query);
}
