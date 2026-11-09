import type { Database } from "../repo.ts";

const TEXT_EXT = /\.(md|txt|json|ya?ml|toml)$/i;

/** Same formula as evidence/usage.transferRate: null when uses <= 0. */
export function transferRate(uses: number, helped: number): number | null {
  if (uses <= 0) return null;
  return Math.round((helped / uses) * 1000) / 1000;
}

export type FileSize = { path: string; size: number };

/** ceil(sum size/4) over text extensions; 0 when no matching files. */
export function tokenCost(files: FileSize[]): number {
  let bytes = 0;
  for (const f of files) {
    if (TEXT_EXT.test(f.path)) bytes += f.size;
  }
  return Math.ceil(bytes / 4);
}

/**
 * transfer_rate / (token_cost/1000), rounded to 3 decimals.
 * null if transfer_rate is null or token_cost is 0.
 */
export function tokenEfficiency(transfer_rate: number | null, token_cost: number): number | null {
  if (transfer_rate === null || token_cost === 0) return null;
  return Math.round((transfer_rate / (token_cost / 1000)) * 1000) / 1000;
}

export type AblationReport = { uplift: number; at: string | null };

/** Uplift of the latest-by-time ablation report; null if none. */
export function ablationScore(reports: AblationReport[]): number | null {
  if (reports.length === 0) return null;
  let best: AblationReport | null = null;
  for (const r of reports) {
    if (!best) {
      best = r;
      continue;
    }
    if (r.at === null) continue;
    if (best.at === null || r.at > best.at) best = r;
  }
  return best!.uplift;
}

/** Parse uplift from a raw evidence item with kind "ablation". */
export function upliftFromAblationItem(raw: Record<string, unknown>): number | null {
  if (typeof raw.uplift === "number" && Number.isFinite(raw.uplift)) return raw.uplift;
  const data = raw.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.uplift === "number" && Number.isFinite(d.uplift)) return d.uplift;
  if (
    typeof d.tasks === "number" &&
    d.tasks > 0 &&
    typeof d.passed_with === "number" &&
    typeof d.passed_without === "number"
  ) {
    return (d.passed_with - d.passed_without) / d.tasks;
  }
  return null;
}

/** Collect ablation reports from a version evidence JSON string. */
export function ablationReportsFromEvidenceJson(evidenceJson: string): AblationReport[] {
  let arr: unknown;
  try {
    arr = JSON.parse(evidenceJson);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: AblationReport[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    if (r.kind !== "ablation") continue;
    const uplift = upliftFromAblationItem(r);
    if (uplift === null) continue;
    out.push({ uplift, at: typeof r.at === "string" ? r.at : null });
  }
  return out;
}

/** Sum text-file sizes from a version files JSON column. */
export function tokenCostFromFilesJson(filesJson: string): number {
  let files: unknown;
  try {
    files = JSON.parse(filesJson);
  } catch {
    return 0;
  }
  if (!Array.isArray(files)) return 0;
  const list: FileSize[] = [];
  for (const f of files) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    if (typeof o.path !== "string" || typeof o.size !== "number") continue;
    list.push({ path: o.path, size: o.size });
  }
  return tokenCost(list);
}

/** Median of token costs; even count -> average of two middle, rounded up to int. */
export function medianTokenCost(costs: number[]): number | null {
  if (costs.length === 0) return null;
  const sorted = [...costs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.ceil((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Latest non-purged version files JSON for an artifact, or null. */
export function latestNonPurgedFilesJson(db: Database, artifactId: string): string | null {
  const byLatest = db
    .prepare(
      `SELECT v.files AS files FROM artifacts a
       JOIN artifact_versions v ON v.artifact_id = a.id AND v.version = a.latest_version
       WHERE a.id = ? AND v.purged_at IS NULL`,
    )
    .get(artifactId) as { files: string } | undefined;
  if (byLatest) return byLatest.files;
  const row = db
    .prepare(
      `SELECT files FROM artifact_versions
       WHERE artifact_id = ? AND purged_at IS NULL
       ORDER BY published_at DESC LIMIT 1`,
    )
    .get(artifactId) as { files: string } | undefined;
  return row?.files ?? null;
}

/** Ablation reports across all versions of an artifact. */
export function artifactAblationReports(db: Database, artifactId: string): AblationReport[] {
  const rows = db
    .prepare("SELECT evidence FROM artifact_versions WHERE artifact_id = ?")
    .all(artifactId) as Array<{ evidence: string }>;
  const out: AblationReport[] = [];
  for (const r of rows) {
    out.push(...ablationReportsFromEvidenceJson(r.evidence));
  }
  return out;
}
