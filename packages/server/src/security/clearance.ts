import type { SecurityReport } from "@skillforge/core";
import type { Database } from "../repo.ts";

/** Identity of a finding: the version content is immutable, only the scanner algorithm changes. */
export type FindingRef = { rule: string; file: string; line: number };

export type SecurityClearance = {
  cleared_by: string;
  cleared_at: string;
  reason: string;
  findings: FindingRef[];
  /** The mark covers every blocking finding of the current report. */
  current: boolean;
};

export type GateResult = { ok: true } | { ok: false; version: string; rules: string[] };

const keyOf = (f: FindingRef): string => `${f.rule}\u0000${f.file}\u0000${f.line}`;

/** Blocking findings of a report: severity high and not a mention (the ones that make the verdict `fail`). */
export function blockingFindings(report: SecurityReport | null | undefined): FindingRef[] {
  const seen = new Map<string, FindingRef>();
  for (const f of report?.findings ?? []) {
    if (f.severity !== "high" || f.mention) continue;
    const ref = { rule: f.rule, file: f.file, line: f.line };
    seen.set(keyOf(ref), ref);
  }
  return [...seen.values()];
}

/** The stored security report of a version (from the quality JSON), or null. */
export function storedSecurityReport(
  db: Database,
  artifactId: string,
  version: string,
): SecurityReport | null {
  const row = db
    .prepare("SELECT quality FROM artifact_versions WHERE artifact_id = ? AND version = ?")
    .get(artifactId, version) as { quality: string | null } | undefined;
  if (!row?.quality) return null;
  try {
    const q = JSON.parse(row.quality) as { security?: SecurityReport };
    return q.security ?? null;
  } catch {
    return null;
  }
}

type ClearanceRow = {
  cleared_by: string;
  cleared_at: string;
  reason: string;
  findings: string;
};

function parseFindings(raw: string): FindingRef[] {
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (f): f is FindingRef =>
        !!f &&
        typeof f.rule === "string" &&
        typeof f.file === "string" &&
        typeof f.line === "number",
    );
  } catch {
    return [];
  }
}

export function getClearance(
  db: Database,
  artifactId: string,
  version: string,
): SecurityClearance | null {
  const row = db
    .prepare(
      `SELECT cleared_by, cleared_at, reason, findings FROM security_clearances
       WHERE artifact_id = ? AND version = ?`,
    )
    .get(artifactId, version) as ClearanceRow | undefined;
  if (!row) return null;
  const findings = parseFindings(row.findings);
  const covered = new Set(findings.map(keyOf));
  const current = blockingFindings(storedSecurityReport(db, artifactId, version)).every((f) =>
    covered.has(keyOf(f)),
  );
  return {
    cleared_by: row.cleared_by,
    cleared_at: row.cleared_at,
    reason: row.reason,
    findings,
    current,
  };
}

/** Stores the mark for the current blocking findings of the version; replaces an older mark. */
export function setClearance(
  db: Database,
  input: { artifactId: string; version: string; clearedBy: string; reason: string; at: string },
): FindingRef[] {
  const findings = blockingFindings(storedSecurityReport(db, input.artifactId, input.version));
  db.prepare(
    `INSERT INTO security_clearances (artifact_id, version, cleared_by, cleared_at, reason, findings)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(artifact_id, version) DO UPDATE SET cleared_by = excluded.cleared_by,
       cleared_at = excluded.cleared_at, reason = excluded.reason, findings = excluded.findings`,
  ).run(
    input.artifactId,
    input.version,
    input.clearedBy,
    input.at,
    input.reason,
    JSON.stringify(findings),
  );
  return findings;
}

/** True when a mark existed. */
export function removeClearance(db: Database, artifactId: string, version: string): boolean {
  const r = db
    .prepare("DELETE FROM security_clearances WHERE artifact_id = ? AND version = ?")
    .run(artifactId, version);
  return Number(r.changes) > 0;
}

/**
 * The one gate for activation, `default`/`required` assignment and method packs: only a version whose verdict is
 * `fail` is refused, and only without a current clearance.
 */
export function securityGate(db: Database, artifactId: string, version: string): GateResult {
  const report = storedSecurityReport(db, artifactId, version);
  if (report?.verdict !== "fail") return { ok: true };
  if (getClearance(db, artifactId, version)?.current) return { ok: true };
  const rules = [...new Set(blockingFindings(report).map((f) => f.rule))];
  return { ok: false, version, rules };
}
