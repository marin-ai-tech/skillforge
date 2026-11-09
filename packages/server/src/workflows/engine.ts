// Workflow run engine.
// Single in-process FIFO queue: one active run at a time, sequential steps through
// spawnIsolated (no shell, env allowlist, timeout + kill-tree). Per-step stdout/stderr go to
// run_outputs (run_kind "workflow", run_id "wf:<id>", name "<workflow>:<step>"); the finished
// run writes one "trace" stream. Cancel is cooperative: checked at each step boundary.
import { spawnIsolated } from "@skillforge/core";
import type { Database } from "../db.ts";
import { appendAudit } from "../repo.ts";
import { recordRunOutputs, storeRunOutputStream } from "../runs/outputs.ts";
import { appendProvenance } from "../provenance/ledger.ts";
import { getRunById } from "./model.ts";
import { validateDefinition, type WorkflowStep } from "./validate.ts";

const STDOUT_TAIL = 500;
const STEP_ERROR_MAX = 500;

type QueueJob = { db: Database; dataDir: string; runId: number };
const queue: QueueJob[] = [];
let active = false;

function nowIso(): string {
  return new Date().toISOString();
}

export function enqueueRun(
  db: Database,
  dataDir: string,
  input: {
    artifactId: string;
    workflowId: string;
    defJson: string;
    inputJson: string | null;
    actor: string;
  },
): number {
  const info = db
    .prepare(
      `INSERT INTO workflow_runs (artifact_id, workflow_id, status, input, def_json, requested_by, created_at)
       VALUES (?, ?, 'queued', ?, ?, ?, ?)`,
    )
    .run(input.artifactId, input.workflowId, input.inputJson, input.defJson, input.actor, nowIso());
  const runId = Number(info.lastInsertRowid);
  queue.push({ db, dataDir, runId });
  // Defer the pump so the 202 response still reports "queued".
  setImmediate(() => void pump());
  return runId;
}

/** Replay: enqueue a new run from the snapshot of an existing one. */
export function replayRun(
  db: Database,
  dataDir: string,
  artifactId: string,
  runId: number,
  actor: string,
): number | null {
  const src = getRunById(db, runId);
  if (!src || src.artifact_id !== artifactId) return null;
  return enqueueRun(db, dataDir, {
    artifactId,
    workflowId: src.workflow_id,
    defJson: src.def_json,
    inputJson: src.input,
    actor,
  });
}

/** Cooperative cancel; true when a queued/running run was marked. */
export function requestCancel(db: Database, artifactId: string, runId: number): boolean {
  const info = db
    .prepare(
      `UPDATE workflow_runs SET cancel_requested = 1
       WHERE id = ? AND artifact_id = ? AND status IN ('queued', 'running')`,
    )
    .run(runId, artifactId);
  return Number(info.changes) > 0;
}

/** Startup: runs interrupted by a previous process die as failed. */
export function interruptStaleWorkflowRuns(db: Database): void {
  db.prepare(
    `UPDATE workflow_runs SET status = 'failed', error = 'interrupted by restart', finished_at = ?
     WHERE status IN ('queued', 'running')`,
  ).run(nowIso());
}

async function pump(): Promise<void> {
  if (active) return;
  const job = queue.shift();
  if (!job) return;
  active = true;
  try {
    await executeRun(job.db, job.dataDir, job.runId);
  } catch (e) {
    finishRun(job.db, job.dataDir, job.runId, "failed", `engine error: ${shortError(e)}`);
  } finally {
    active = false;
    if (queue.length) setImmediate(() => void pump());
  }
}

function shortError(e: unknown): string {
  return String((e as Error)?.message ?? e).slice(0, STEP_ERROR_MAX);
}

function artifactVersion(db: Database, artifactId: string): string {
  const row = db.prepare("SELECT latest_version FROM artifacts WHERE id = ?").get(artifactId) as
    { latest_version: string | null } | undefined;
  return row?.latest_version ?? "0.0.0";
}

function cancelRequested(db: Database, runId: number): boolean {
  const row = db
    .prepare("SELECT cancel_requested AS c FROM workflow_runs WHERE id = ?")
    .get(runId) as { c: number } | undefined;
  return row?.c === 1;
}

function markRunning(db: Database, runId: number): void {
  db.prepare("UPDATE workflow_runs SET status = 'running', started_at = ? WHERE id = ?").run(
    nowIso(),
    runId,
  );
}

function finishRun(
  db: Database,
  dataDir: string,
  runId: number,
  status: "done" | "failed" | "cancelled",
  error: string | null = null,
): void {
  const finished = nowIso();
  db.prepare("UPDATE workflow_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?").run(
    status,
    error,
    finished,
    runId,
  );
  const run = getRunById(db, runId);
  if (!run) return;
  try {
    appendProvenance(db, {
      artifact_id: run.artifact_id,
      kind: "workflow",
      source: "system",
      ref: `workflow_run:${runId}`,
      actor: run.requested_by,
      meta: { workflow_id: run.workflow_id, status },
    });
  } catch {
    /* a ledger write must not break run finalization */
  }
  const steps = db
    .prepare("SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY position")
    .all(runId);
  try {
    storeRunOutputStream(
      db,
      dataDir,
      {
        runId: `wf:${runId}`,
        runKind: "workflow",
        artifactId: run.artifact_id,
        version: artifactVersion(db, run.artifact_id),
        stream: "trace",
        name: `${run.workflow_id}:trace`,
        actor: run.requested_by,
      },
      JSON.stringify({
        protocol: 1,
        run_id: runId,
        workflow_id: run.workflow_id,
        status,
        error,
        input: run.input ? JSON.parse(run.input) : null,
        steps,
      }),
    );
  } catch {
    /* trace persistence is best effort */
  }
  appendAudit(db, {
    ts: finished,
    actor: "system",
    artifact_id: run.artifact_id,
    version: null,
    action: "workflow_run",
    meta: { workflow_id: run.workflow_id, run_id: runId, status },
  });
}

type RunCtx = {
  db: Database;
  dataDir: string;
  runId: number;
  runName: string;
  artifactId: string;
  workflowId: string;
  version: string;
  actor: string;
};

type StepOutcome = {
  success: boolean;
  next: string;
  result: Awaited<ReturnType<typeof spawnIsolated>>;
};

async function execStep(
  ctx: RunCtx,
  step: WorkflowStep,
  inputJson: unknown,
  prev: { id: string; exit: number | null; stdout_tail: string } | null,
  position: number,
  defaultNext: string,
): Promise<StepOutcome> {
  const startedAt = nowIso();
  const result = await spawnIsolated(step.argv, {
    envNames: step.env,
    timeoutS: step.timeout_s,
    stdin: JSON.stringify({
      protocol: 1,
      workflow: ctx.workflowId,
      step: step.id,
      input: inputJson,
      prev,
    }),
  });
  const finishedAt = nowIso();
  try {
    recordRunOutputs(
      ctx.db,
      ctx.dataDir,
      {
        runId: ctx.runName,
        runKind: "workflow",
        artifactId: ctx.artifactId,
        version: ctx.version,
        name: `${ctx.workflowId}:${step.id}`,
        actor: ctx.actor,
      },
      result,
    );
  } catch {
    /* output persistence is best effort */
  }
  const success = !result.error && !result.timedOut && result.code === 0;
  const next = success ? (step.on_success ?? defaultNext) : (step.on_failure ?? "fail");
  ctx.db
    .prepare(
      `INSERT INTO workflow_run_steps
         (run_id, position, step_id, status, exit_code, timed_out, next_step, duration_ms, started_at, finished_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.runId,
      position,
      step.id,
      success ? "done" : "failed",
      result.error ? null : result.code,
      result.timedOut ? 1 : 0,
      next,
      Math.round(result.duration_ms || 0),
      startedAt,
      finishedAt,
      success ? null : shortError(result.error ?? result.stderr ?? "non-zero exit"),
    );
  return { success, next, result };
}

function lastPosition(db: Database, runId: number): number {
  const row = db
    .prepare("SELECT MAX(position) AS p FROM workflow_run_steps WHERE run_id = ?")
    .get(runId) as { p: number | null };
  return row.p ?? 0;
}

/** Runs of a step since the last resume: a resume starts the count of rounds again. */
function visitsSinceResume(db: Database, runId: number, stepId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM workflow_run_steps
       WHERE run_id = ? AND step_id = ? AND status IN ('done', 'failed')
         AND position > COALESCE((SELECT MAX(position) FROM workflow_run_steps
                                  WHERE run_id = ? AND status = 'resumed'), 0)`,
    )
    .get(runId, stepId, runId) as { n: number | bigint };
  return Number(row.n);
}

/** A step row that ran no command: a gate waiting, a step out of visits, a resume mark. */
function insertMarker(
  db: Database,
  runId: number,
  position: number,
  stepId: string,
  status: "waiting" | "exhausted" | "resumed",
  next: string | null,
  decidedBy: string | null = null,
): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO workflow_run_steps
       (run_id, position, step_id, status, exit_code, timed_out, next_step, duration_ms, started_at, finished_at,
        error, decided_by)
     VALUES (?, ?, ?, ?, NULL, 0, ?, 0, ?, ?, NULL, ?)`,
  ).run(runId, position, stepId, status, next, now, now, decidedBy);
}

function requeue(db: Database, dataDir: string, runId: number, from: string): void {
  db.prepare(
    `UPDATE workflow_runs SET status = 'queued', resume_from = ?, error = NULL, finished_at = NULL,
       cancel_requested = 0 WHERE id = ?`,
  ).run(from, runId);
  queue.push({ db, dataDir, runId });
  setImmediate(() => void pump());
}

export type GateDecision = { decision: "approve" | "reject"; reason: string | null; actor: string };

/**
 * workflow gates: a person decides on the gate the run waits at. Approve follows on_success, reject on_failure;
 * the decision, who made it and why stay in the step row. Null when the run does not wait at this step.
 */
export function decideGate(
  db: Database,
  dataDir: string,
  run: { id: number; status: string; def_json: string },
  stepId: string,
  d: GateDecision,
): "ok" | "not_waiting" {
  if (run.status !== "waiting") return "not_waiting";
  const waiting = db
    .prepare(
      `SELECT position, step_id FROM workflow_run_steps WHERE run_id = ? AND status = 'waiting'
       ORDER BY position DESC LIMIT 1`,
    )
    .get(run.id) as { position: number; step_id: string } | undefined;
  if (!waiting || waiting.step_id !== stepId) return "not_waiting";
  const parsed = validateDefinition(JSON.parse(run.def_json));
  if (!parsed.ok) return "not_waiting";
  const steps = parsed.definition.steps;
  const step = steps.find((x) => x.id === stepId)!;
  const i = steps.indexOf(step);
  const next =
    d.decision === "approve"
      ? (step.on_success ?? (i + 1 < steps.length ? steps[i + 1]!.id : "end"))
      : (step.on_failure ?? "fail");
  db.prepare(
    `UPDATE workflow_run_steps SET status = ?, next_step = ?, decided_by = ?, reason = ?, finished_at = ?
     WHERE run_id = ? AND position = ?`,
  ).run(
    d.decision === "approve" ? "done" : "failed",
    next,
    d.actor,
    d.reason,
    nowIso(),
    run.id,
    waiting.position,
  );
  if (next === "end") finishRun(db, dataDir, run.id, "done");
  else if (next === "fail") finishRun(db, dataDir, run.id, "failed", `gate "${stepId}" rejected`);
  else requeue(db, dataDir, run.id, next);
  return "ok";
}

/** workflow gates: a stopped run continues from the step it stopped at; what was done is not repeated. */
export function resumeRun(
  db: Database,
  dataDir: string,
  run: { id: number; status: string; current_step?: string | null },
  actor: string,
): "ok" | "not_stopped" {
  if (!["failed", "cancelled"].includes(run.status) || !run.current_step) return "not_stopped";
  insertMarker(
    db,
    run.id,
    lastPosition(db, run.id) + 1,
    run.current_step,
    "resumed",
    run.current_step,
    actor,
  );
  requeue(db, dataDir, run.id, run.current_step);
  return "ok";
}

/** A waiting run is not in the queue: cancelling it finishes it at once. */
export function cancelWaiting(
  db: Database,
  dataDir: string,
  artifactId: string,
  runId: number,
): boolean {
  const info = db
    .prepare(
      "UPDATE workflow_runs SET cancel_requested = 1 WHERE id = ? AND artifact_id = ? AND status = 'waiting'",
    )
    .run(runId, artifactId);
  if (Number(info.changes) === 0) return false;
  finishRun(db, dataDir, runId, "cancelled");
  return true;
}

/**
 * workflow gates: what happens at a step before any command runs. "stop" — the run waits at a gate or has finished;
 * a step id — go there (visits used up); "run" — execute the step. The position is used by the marker row.
 */
function specialStep(
  db: Database,
  dataDir: string,
  runId: number,
  step: WorkflowStep,
  position: number,
): "stop" | "run" | string {
  db.prepare("UPDATE workflow_runs SET current_step = ? WHERE id = ?").run(step.id, runId);
  if (step.kind === "gate") {
    insertMarker(db, runId, position, step.id, "waiting", null);
    db.prepare("UPDATE workflow_runs SET status = 'waiting' WHERE id = ?").run(runId);
    return "stop";
  }
  if (step.max_visits === null || visitsSinceResume(db, runId, step.id) < step.max_visits)
    return "run";
  const next = step.on_exhausted ?? "fail";
  insertMarker(db, runId, position, step.id, "exhausted", next);
  if (next === "end") finishRun(db, dataDir, runId, "done");
  else if (next === "fail") {
    finishRun(db, dataDir, runId, "failed", `step "${step.id}" used up ${step.max_visits} visits`);
  } else return next;
  return "stop";
}

function runContext(
  db: Database,
  dataDir: string,
  run: NonNullable<ReturnType<typeof getRunById>>,
): RunCtx {
  return {
    db,
    dataDir,
    runId: run.id,
    runName: `wf:${run.id}`,
    artifactId: run.artifact_id,
    workflowId: run.workflow_id,
    version: artifactVersion(db, run.artifact_id),
    actor: run.requested_by,
  };
}

/** Invalid stored input is passed to the steps as null. */
function storedInput(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function executeRun(db: Database, dataDir: string, runId: number): Promise<void> {
  const run = getRunById(db, runId);
  if (!run || run.status !== "queued") return;
  if (run.cancel_requested) {
    finishRun(db, dataDir, runId, "cancelled");
    return;
  }
  markRunning(db, runId);

  const parsed = validateDefinition(JSON.parse(run.def_json));
  if (!parsed.ok) {
    finishRun(db, dataDir, runId, "failed", "invalid definition snapshot");
    return;
  }
  const def = parsed.definition;
  const byId = new Map(def.steps.map((s) => [s.id, s]));
  const defaultNext = (s: WorkflowStep): string => {
    const i = def.steps.indexOf(s);
    return i + 1 < def.steps.length ? def.steps[i + 1]!.id : "end";
  };
  const ctx = runContext(db, dataDir, run);
  const inputJson = storedInput(run.input);

  let current: WorkflowStep | undefined = run.resume_from
    ? byId.get(run.resume_from)
    : def.steps[0];
  let prev: { id: string; exit: number | null; stdout_tail: string } | null = null;
  let position = lastPosition(db, runId);
  db.prepare("UPDATE workflow_runs SET resume_from = NULL WHERE id = ?").run(runId);

  while (current) {
    if (cancelRequested(db, runId)) {
      finishRun(db, dataDir, runId, "cancelled");
      return;
    }
    const step = current;
    const special = specialStep(db, dataDir, runId, step, (position += 1));
    if (special === "stop") return;
    if (special !== "run") {
      current = byId.get(special);
      continue;
    }
    const { next, result } = await execStep(
      ctx,
      step,
      inputJson,
      prev,
      (position += 1),
      defaultNext(step),
    );
    if (next === "end") {
      finishRun(db, dataDir, runId, "done");
      return;
    }
    if (next === "fail") {
      finishRun(db, dataDir, runId, "failed", `step "${step.id}" failed`);
      return;
    }
    prev = {
      id: step.id,
      exit: result.error ? null : result.code,
      stdout_tail: (result.stdout ?? "").slice(-STDOUT_TAIL),
    };
    current = byId.get(next);
    if (!current) {
      finishRun(db, dataDir, runId, "failed", `unresolved step "${next}"`);
      return;
    }
  }
}
