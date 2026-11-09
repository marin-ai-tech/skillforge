import type { Database } from "../db.ts";

export type ProvenanceKind = "publish" | "import" | "derive" | "eval" | "workflow";

export type ProvenanceEntry = {
  artifact_id: string;
  version?: string | null;
  kind: ProvenanceKind;
  source: string;
  ref?: string | null;
  transform?: string | null;
  parent_artifact_id?: string | null;
  parent_version?: string | null;
  actor?: string | null;
  meta?: Record<string, unknown>;
};

export type ProvenanceRow = ProvenanceEntry & {
  id: number;
  ts: string;
  meta: Record<string, unknown>;
};

/** Re-created by the purge eraser after its trigger-bypassing DELETE. */
export const LEDGER_DELETE_TRIGGER_SQL = `CREATE TRIGGER pl_no_delete BEFORE DELETE ON provenance_ledger
BEGIN
  SELECT RAISE(ABORT, 'provenance_ledger is append-only');
END`;

export function appendProvenance(db: Database, e: ProvenanceEntry): void {
  db.prepare(
    `INSERT INTO provenance_ledger
     (artifact_id, version, kind, source, ref, transform, parent_artifact_id, parent_version, actor, ts, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    e.artifact_id,
    e.version ?? null,
    e.kind,
    e.source,
    e.ref ?? null,
    e.transform ?? null,
    e.parent_artifact_id ?? null,
    e.parent_version ?? null,
    e.actor ?? null,
    new Date().toISOString(),
    JSON.stringify(e.meta ?? {}),
  );
}

export function listProvenance(
  db: Database,
  artifactId: string,
  opts: { version?: string; kind?: string } = {},
): ProvenanceRow[] {
  const where = ["artifact_id = ?"];
  const params: (string | number)[] = [artifactId];
  if (opts.version) {
    where.push("version = ?");
    params.push(opts.version);
  }
  if (opts.kind) {
    where.push("kind = ?");
    params.push(opts.kind);
  }
  const rows = db
    .prepare(
      `SELECT * FROM provenance_ledger WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 500`,
    )
    .all(...params) as Array<Omit<ProvenanceRow, "meta"> & { meta: string }>;
  return rows.map((r) => ({ ...r, meta: JSON.parse(r.meta) as Record<string, unknown> }));
}
