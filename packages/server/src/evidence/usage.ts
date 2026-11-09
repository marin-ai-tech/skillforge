import semver from "semver";
import type { Database } from "../repo.ts";

export const MAX_USES_PER_REPORT = 100000;
export const MAX_USAGE_SOURCE = 64;
export const MAX_REPORT_ID = 128;
export const MAX_REPORTS_PER_DAY = 200;

export type UsageStats = { uses: number; helped: number; transfer_rate: number | null };

/** `loaded`: the skill was really applied; `assigned`: only assigned to a role, not counted. */
export const USAGE_BASES = ["loaded", "assigned"] as const;
export type UsageBasis = (typeof USAGE_BASES)[number];

export type UsageInput = {
  version: string | null;
  uses: number;
  helped: number;
  source: string | null;
  report_id: string | null;
  basis: UsageBasis | null;
};

export function transferRate(uses: number, helped: number): number | null {
  if (uses <= 0) return null;
  return Math.round((helped / uses) * 1000) / 1000;
}

export function usageStats(uses: number, helped: number): UsageStats {
  return { uses, helped, transfer_rate: transferRate(uses, helped) };
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_USES_PER_REPORT;
}

function optionalString(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length === 0 || v.length > max) return undefined;
  return v;
}

/** `null` means the latest version; `undefined` means invalid. */
function parseUsageVersion(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "latest") return null;
  return typeof v === "string" && semver.valid(v) !== null ? v : undefined;
}

/** `null` means the report does not say; `undefined` means invalid. */
function parseUsageBasis(v: unknown): UsageBasis | null | undefined {
  if (v === undefined || v === null) return null;
  return USAGE_BASES.includes(v as UsageBasis) ? (v as UsageBasis) : undefined;
}

/** Boundary parse of a usage report; `undefined` means `usage_invalid`. */
export function parseUsageInput(body: unknown): UsageInput | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const b = body as Record<string, unknown>;
  if (!isCount(b.uses) || !isCount(b.helped) || b.helped > b.uses) return undefined;
  const version = parseUsageVersion(b.version);
  if (version === undefined) return undefined;
  const source = optionalString(b.source, MAX_USAGE_SOURCE);
  const reportId = optionalString(b.report_id, MAX_REPORT_ID);
  if (source === undefined || reportId === undefined) return undefined;
  const basis = parseUsageBasis(b.basis);
  if (basis === undefined) return undefined;
  return {
    version,
    uses: b.uses,
    helped: b.helped,
    source,
    report_id: reportId,
    basis,
  };
}

export type RecordUsageResult =
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "created" | "duplicate"; version: string; use_count: number; help_count: number };

export type UsageResponse = {
  version: string;
  use_count: number;
  help_count: number;
  transfer_rate: number | null;
};

export function usageResponse(r: {
  version: string;
  use_count: number;
  help_count: number;
}): UsageResponse {
  return {
    version: r.version,
    use_count: r.use_count,
    help_count: r.help_count,
    transfer_rate: transferRate(r.use_count, r.help_count),
  };
}

function versionCounters(
  db: Database,
  artifactId: string,
  version: string,
): { use_count: number; help_count: number } | null {
  const row = db
    .prepare(
      "SELECT use_count, help_count FROM artifact_versions WHERE artifact_id = ? AND version = ?",
    )
    .get(artifactId, version) as
    { use_count: number | bigint; help_count: number | bigint } | undefined;
  if (!row) return null;
  return { use_count: Number(row.use_count), help_count: Number(row.help_count) };
}

function utcDayStart(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

/**
 * Records one attributed usage report and bumps the version counters in the same
 * `BEGIN IMMEDIATE` transaction. The artifact and its `latest_version` are re-read inside it.
 */
export function recordUsage(
  db: Database,
  input: {
    type: string;
    name: string;
    reporter: string;
    source: string;
    report: UsageInput;
    /** Extra visibility rule for the re-read artifact (MCP). */
    visible?: (row: {
      id: string;
      status: string;
      tags: string;
      labels: string;
      visibility: string;
      owner_team: string | null;
      owner: string;
    }) => boolean;
  },
): RecordUsageResult {
  const now = new Date();
  const at = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        "SELECT id, status, tags, labels, visibility, owner_team, owner, latest_version FROM artifacts WHERE type = ? AND name = ?",
      )
      .get(input.type, input.name) as
      | {
          id: string;
          status: string;
          tags: string;
          labels: string;
          visibility: string;
          owner_team: string | null;
          owner: string;
          latest_version: string | null;
        }
      | undefined;
    if (!row || (input.visible && !input.visible(row))) {
      db.exec("ROLLBACK");
      return { kind: "not_found" };
    }

    const { report } = input;
    if (report.report_id !== null) {
      const prior = db
        .prepare(
          "SELECT artifact_id, version FROM artifact_usage_reports WHERE reporter = ? AND report_id = ?",
        )
        .get(input.reporter, report.report_id) as
        { artifact_id: string; version: string } | undefined;
      if (prior) {
        const counters = versionCounters(db, prior.artifact_id, prior.version);
        db.exec("ROLLBACK");
        if (!counters) return { kind: "not_found" };
        return { kind: "duplicate", version: prior.version, ...counters };
      }
    }

    const version = report.version ?? row.latest_version;
    const counters = version ? versionCounters(db, row.id, version) : null;
    if (!version || !counters) {
      db.exec("ROLLBACK");
      return { kind: "not_found" };
    }

    const today = db
      .prepare(
        `SELECT COUNT(*) AS n FROM artifact_usage_reports
         WHERE reporter = ? AND artifact_id = ? AND reported_at >= ?`,
      )
      .get(input.reporter, row.id, utcDayStart(now)) as { n: number | bigint };
    if (Number(today.n) >= MAX_REPORTS_PER_DAY) {
      db.exec("ROLLBACK");
      return { kind: "rate_limited" };
    }

    db.prepare(
      `INSERT INTO artifact_usage_reports
         (artifact_id, version, reporter, uses, helped, source, report_id, reported_at, basis)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      version,
      input.reporter,
      report.uses,
      report.helped,
      input.source,
      report.report_id,
      at,
      report.basis,
    );
    // An assigned report stays in the reports only: Transfer Rate and lifecycle read these counters.
    const counted = report.basis === "assigned" ? { uses: 0, helped: 0 } : report;
    db.prepare(
      `UPDATE artifact_versions SET use_count = use_count + ?, help_count = help_count + ?
       WHERE artifact_id = ? AND version = ?`,
    ).run(counted.uses, counted.helped, row.id, version);
    db.exec("COMMIT");
    return {
      kind: "created",
      version,
      use_count: counters.use_count + counted.uses,
      help_count: counters.help_count + counted.helped,
    };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export type UsageBySource = {
  source: string;
  basis: UsageBasis | null;
  reports: number;
  reporters: number;
} & UsageStats;

export type UsageSummary = {
  versions: Array<{ version: string } & UsageStats>;
  total: UsageStats;
  by_source: UsageBySource[];
};

/**
 * Reports per source and basis over all versions: an agent's
 * self-reports stay apart from data of sessions or people. An `assigned` row has no rate: nothing was applied.
 * Counters written without reports (import) are not in here, so the sum may be lower than `total`.
 */
function usageBySource(db: Database, artifactId: string): UsageBySource[] {
  const rows = db
    .prepare(
      `SELECT source, basis, COUNT(*) AS reports, COUNT(DISTINCT reporter) AS reporters,
              SUM(uses) AS uses, SUM(helped) AS helped
       FROM artifact_usage_reports WHERE artifact_id = ?
       GROUP BY source, basis ORDER BY SUM(uses) DESC, source ASC, basis ASC`,
    )
    .all(artifactId) as Array<
    Record<"reports" | "reporters" | "uses" | "helped", number | bigint> & {
      source: string;
      basis: UsageBasis | null;
    }
  >;
  return rows.map((r) => {
    const stats = usageStats(Number(r.uses), Number(r.helped));
    return {
      source: r.source,
      basis: r.basis,
      reports: Number(r.reports),
      reporters: Number(r.reporters),
      ...stats,
      transfer_rate: r.basis === "assigned" ? null : stats.transfer_rate,
    };
  });
}

export function usageSummary(db: Database, artifactId: string): UsageSummary {
  const rows = db
    .prepare("SELECT version, use_count, help_count FROM artifact_versions WHERE artifact_id = ?")
    .all(artifactId) as Array<{
    version: string;
    use_count: number | bigint;
    help_count: number | bigint;
  }>;
  let uses = 0;
  let helped = 0;
  const versions = rows
    .map((r) => {
      const u = Number(r.use_count);
      const h = Number(r.help_count);
      uses += u;
      helped += h;
      return { version: r.version, ...usageStats(u, h) };
    })
    .sort((a, b) => semver.rcompare(a.version, b.version));
  return { versions, total: usageStats(uses, helped), by_source: usageBySource(db, artifactId) };
}
