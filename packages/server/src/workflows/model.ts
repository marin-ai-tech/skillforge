// Workflow engine data model.
import type { Database } from "../db.ts";

export type WorkflowRunStatus = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";

export type WorkflowRow = {
  artifact_id: string;
  workflow_id: string;
  name: string | null;
  definition: string;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
};

export type WorkflowRunRow = {
  id: number;
  artifact_id: string;
  workflow_id: string;
  status: WorkflowRunStatus;
  input: string | null;
  def_json: string;
  cancel_requested: number;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  /** workflow gates: where the run continues, and the step it ran last. */
  resume_from?: string | null;
  current_step?: string | null;
};

export type WorkflowStepRow = {
  run_id: number;
  position: number;
  step_id: string;
  status: "done" | "failed" | "waiting" | "exhausted" | "resumed";
  exit_code: number | null;
  timed_out: number;
  next_step: string | null;
  duration_ms: number | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  decided_by?: string | null;
  reason?: string | null;
};

export function getWorkflow(
  db: Database,
  artifactId: string,
  workflowId: string,
): WorkflowRow | undefined {
  return db
    .prepare("SELECT * FROM workflows WHERE artifact_id = ? AND workflow_id = ?")
    .get(artifactId, workflowId) as WorkflowRow | undefined;
}

export function listWorkflows(db: Database, artifactId: string): WorkflowRow[] {
  return db
    .prepare("SELECT * FROM workflows WHERE artifact_id = ? ORDER BY workflow_id")
    .all(artifactId) as WorkflowRow[];
}

export function upsertWorkflow(
  db: Database,
  input: {
    artifactId: string;
    workflowId: string;
    name: string | null;
    definition: string;
    actor: string;
    now: string;
  },
): void {
  db.prepare(
    `INSERT INTO workflows (artifact_id, workflow_id, name, definition, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (artifact_id, workflow_id)
     DO UPDATE SET name = excluded.name, definition = excluded.definition,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(
    input.artifactId,
    input.workflowId,
    input.name,
    input.definition,
    input.actor,
    input.now,
    input.actor,
    input.now,
  );
}

export function deleteWorkflow(db: Database, artifactId: string, workflowId: string): boolean {
  const info = db
    .prepare("DELETE FROM workflows WHERE artifact_id = ? AND workflow_id = ?")
    .run(artifactId, workflowId);
  return Number(info.changes) > 0;
}

export function listRuns(db: Database, artifactId: string, limit = 100): WorkflowRunRow[] {
  return db
    .prepare("SELECT * FROM workflow_runs WHERE artifact_id = ? ORDER BY id DESC LIMIT ?")
    .all(artifactId, limit) as WorkflowRunRow[];
}

export function getRunById(db: Database, runId: number): WorkflowRunRow | undefined {
  return db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(runId) as
    WorkflowRunRow | undefined;
}

export function getRun(
  db: Database,
  artifactId: string,
  runId: number,
): WorkflowRunRow | undefined {
  return db
    .prepare("SELECT * FROM workflow_runs WHERE id = ? AND artifact_id = ?")
    .get(runId, artifactId) as WorkflowRunRow | undefined;
}

export function listSteps(db: Database, runId: number): WorkflowStepRow[] {
  return db
    .prepare("SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY position")
    .all(runId) as WorkflowStepRow[];
}

export type RunView = Omit<WorkflowRunRow, "input" | "def_json" | "cancel_requested"> & {
  input: unknown;
  steps?: WorkflowStepRow[];
};

export function runToView(row: WorkflowRunRow, steps?: WorkflowStepRow[]): RunView {
  const { input, def_json: _def, cancel_requested: _c, ...rest } = row;
  let parsed: unknown = null;
  try {
    parsed = input ? JSON.parse(input) : null;
  } catch {
    parsed = null;
  }
  return { ...rest, input: parsed, ...(steps ? { steps } : {}) };
}
