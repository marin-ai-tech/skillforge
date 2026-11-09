// Routines engine data model.
import type { Database } from "../db.ts";

export type RoutineRunStatus = "queued" | "running" | "done" | "failed" | "skipped";
export type RoutineTrigger = "schedule" | "manual";

export type RoutineRow = {
  artifact_id: string;
  routine_id: string;
  name: string | null;
  definition: string;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  consecutive_failures: number;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
};

export type RoutineRunRow = {
  id: number;
  artifact_id: string;
  routine_id: string;
  status: RoutineRunStatus;
  trigger: RoutineTrigger;
  triggered_by: string;
  exit_code: number | null;
  timed_out: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export function getRoutine(
  db: Database,
  artifactId: string,
  routineId: string,
): RoutineRow | undefined {
  return db
    .prepare("SELECT * FROM routines WHERE artifact_id = ? AND routine_id = ?")
    .get(artifactId, routineId) as RoutineRow | undefined;
}

export function listRoutines(db: Database, artifactId: string): RoutineRow[] {
  return db
    .prepare("SELECT * FROM routines WHERE artifact_id = ? ORDER BY routine_id")
    .all(artifactId) as RoutineRow[];
}

export function upsertRoutine(
  db: Database,
  input: {
    artifactId: string;
    routineId: string;
    name: string | null;
    definition: string;
    enabled: number;
    nextRunAt: string | null;
    actor: string;
    now: string;
  },
): void {
  db.prepare(
    `INSERT INTO routines
       (artifact_id, routine_id, name, definition, enabled, next_run_at,
        consecutive_failures, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
     ON CONFLICT (artifact_id, routine_id)
     DO UPDATE SET name = excluded.name, definition = excluded.definition,
       enabled = excluded.enabled, next_run_at = excluded.next_run_at,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(
    input.artifactId,
    input.routineId,
    input.name,
    input.definition,
    input.enabled,
    input.nextRunAt,
    input.actor,
    input.now,
    input.actor,
    input.now,
  );
}

export function deleteRoutine(db: Database, artifactId: string, routineId: string): boolean {
  const info = db
    .prepare("DELETE FROM routines WHERE artifact_id = ? AND routine_id = ?")
    .run(artifactId, routineId);
  return Number(info.changes) > 0;
}

export function dueRoutines(db: Database, nowIso: string, limit = 20): RoutineRow[] {
  return db
    .prepare(
      `SELECT * FROM routines WHERE enabled = 1 AND next_run_at IS NOT NULL
         AND next_run_at <= ? ORDER BY next_run_at LIMIT ?`,
    )
    .all(nowIso, limit) as RoutineRow[];
}

export function hasActiveRun(db: Database, artifactId: string, routineId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS n FROM routine_runs
       WHERE artifact_id = ? AND routine_id = ? AND status IN ('queued', 'running') LIMIT 1`,
    )
    .get(artifactId, routineId) as { n: number } | undefined;
  return !!row;
}

export function insertRun(
  db: Database,
  input: {
    artifactId: string;
    routineId: string;
    status: RoutineRunStatus;
    trigger: RoutineTrigger;
    actor: string;
    now: string;
  },
): number {
  const info = db
    .prepare(
      `INSERT INTO routine_runs
         (artifact_id, routine_id, status, trigger, triggered_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.artifactId, input.routineId, input.status, input.trigger, input.actor, input.now);
  return Number(info.lastInsertRowid);
}

export function runsToday(db: Database, artifactId: string, routineId: string, dayIso: string) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM routine_runs
       WHERE artifact_id = ? AND routine_id = ? AND created_at >= ? AND status != 'skipped'`,
    )
    .get(artifactId, routineId, dayIso) as { n: number };
  return row.n;
}

export function listRuns(db: Database, artifactId: string, limit = 100): RoutineRunRow[] {
  return db
    .prepare("SELECT * FROM routine_runs WHERE artifact_id = ? ORDER BY id DESC LIMIT ?")
    .all(artifactId, limit) as RoutineRunRow[];
}

export function getRun(db: Database, artifactId: string, runId: number): RoutineRunRow | undefined {
  return db
    .prepare("SELECT * FROM routine_runs WHERE id = ? AND artifact_id = ?")
    .get(runId, artifactId) as RoutineRunRow | undefined;
}

export function getRunById(db: Database, runId: number): RoutineRunRow | undefined {
  return db.prepare("SELECT * FROM routine_runs WHERE id = ?").get(runId) as
    RoutineRunRow | undefined;
}
