// Routines scheduler + executor.
// In-process single-flight queue: a tick picks enabled routines whose next_run_at is due,
// each fire enqueues one run (no pileup while a run of the same routine is active).
// Steps execute via spawnIsolated in the routine's persistent state dir (cwd), stdout/stderr
// go to run_outputs (run_kind "routine", run_id "rt:<id>"). Global kill switch:
// SKILLFORGE_ROUTINES_DISABLED (AppConfig.routinesDisabled, parsed at startup) — no ticks at all.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnIsolated } from "@skillforge/core";
import type { Database } from "../db.ts";
import { appendAudit } from "../repo.ts";
import { recordRunOutputs } from "../runs/outputs.ts";
import {
  dueRoutines,
  getRoutine,
  getRunById,
  hasActiveRun,
  insertRun,
  runsToday,
  type RoutineRow,
} from "./model.ts";
import { nextRunAt, validateRoutineDefinition } from "./schedule.ts";

const TICK_MS = 500;
const DAY_MS = 86400000;
const ERROR_MAX = 500;

type Job = { db: Database; dataDir: string; runId: number };
const queue: Job[] = [];
let timer: NodeJS.Timeout | null = null;
let active = false;

function nowIso(): string {
  return new Date().toISOString();
}

export function startRoutinesScheduler(
  db: Database,
  dataDir: string,
  opts: { routinesDisabled: boolean },
): void {
  stopRoutinesScheduler();
  // Kill switch: no scheduled fires at all; manual run-now (enqueueRun) still works.
  if (opts.routinesDisabled) return;
  timer = setInterval(() => {
    try {
      tick(db, dataDir);
    } catch {
      /* a tick must never kill the server */
    }
  }, TICK_MS);
  timer.unref();
}

export function stopRoutinesScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Startup: runs interrupted by a previous process die as failed. */
export function interruptStaleRoutineRuns(db: Database): void {
  db.prepare(
    `UPDATE routine_runs SET status = 'failed', error = 'interrupted by restart', finished_at = ?
     WHERE status IN ('queued', 'running')`,
  ).run(nowIso());
}

function artifactVersion(db: Database, artifactId: string): string {
  const row = db.prepare("SELECT latest_version FROM artifacts WHERE id = ?").get(artifactId) as
    { latest_version: string | null } | undefined;
  return row?.latest_version ?? "0.0.0";
}

export function budgetExhausted(
  db: Database,
  artifactId: string,
  routineId: string,
  maxPerDay: number | null,
): boolean {
  if (maxPerDay === null) return false;
  const dayStart = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS).toISOString();
  return runsToday(db, artifactId, routineId, dayStart) >= maxPerDay;
}

/** Enqueue one run (schedule or manual); returns run id, or 'budget' when exhausted. */
export function enqueueRun(
  db: Database,
  dataDir: string,
  input: {
    artifactId: string;
    routineId: string;
    trigger: "schedule" | "manual";
    actor: string;
    maxPerDay?: number | null;
  },
): number | "budget" {
  if (budgetExhausted(db, input.artifactId, input.routineId, input.maxPerDay ?? null)) {
    return "budget";
  }
  const runId = insertRun(db, {
    artifactId: input.artifactId,
    routineId: input.routineId,
    status: "queued",
    trigger: input.trigger,
    actor: input.actor,
    now: nowIso(),
  });
  queue.push({ db, dataDir, runId });
  setImmediate(() => void pump());
  return runId;
}

function tick(db: Database, dataDir: string): void {
  for (const rt of dueRoutines(db, nowIso())) {
    // Reschedule first so a crash between tick and run does not refire immediately.
    // Conditional on the value we read: if another server process on the same
    // database already claimed this slot, the UPDATE changes nothing and we skip the run.
    const def = validateRoutineDefinition(JSON.parse(rt.definition));
    const claimed = db
      .prepare(
        "UPDATE routines SET next_run_at = ? WHERE artifact_id = ? AND routine_id = ? AND next_run_at IS ?",
      )
      .run(
        def.ok ? nextRunAt(def.definition.schedule, new Date()) : null,
        rt.artifact_id,
        rt.routine_id,
        rt.next_run_at,
      );
    if (Number(claimed.changes) !== 1) continue;
    if (!def.ok) {
      db.prepare("UPDATE routines SET enabled = 0 WHERE artifact_id = ? AND routine_id = ?").run(
        rt.artifact_id,
        rt.routine_id,
      );
      continue;
    }
    if (hasActiveRun(db, rt.artifact_id, rt.routine_id)) continue;
    if (
      budgetExhausted(db, rt.artifact_id, rt.routine_id, def.definition.budgets.max_runs_per_day)
    ) {
      const skippedId = insertRun(db, {
        artifactId: rt.artifact_id,
        routineId: rt.routine_id,
        status: "skipped",
        trigger: "schedule",
        actor: "system",
        now: nowIso(),
      });
      db.prepare("UPDATE routine_runs SET finished_at = ? WHERE id = ?").run(nowIso(), skippedId);
      continue;
    }
    enqueueRun(db, dataDir, {
      artifactId: rt.artifact_id,
      routineId: rt.routine_id,
      trigger: "schedule",
      actor: "system",
      maxPerDay: def.definition.budgets.max_runs_per_day,
    });
  }
}

async function pump(): Promise<void> {
  if (active) return;
  const job = queue.shift();
  if (!job) return;
  active = true;
  try {
    await executeRun(job.db, job.dataDir, job.runId);
  } catch (e) {
    finishRun(job.db, job.runId, "failed", {
      error: `engine error: ${String((e as Error)?.message ?? e).slice(0, ERROR_MAX)}`,
    });
  } finally {
    active = false;
    if (queue.length) setImmediate(() => void pump());
  }
}

function finishRun(
  db: Database,
  runId: number,
  status: "done" | "failed" | "skipped",
  result: {
    exit_code?: number | null;
    timed_out?: boolean;
    duration_ms?: number;
    error?: string | null;
  } = {},
): void {
  const finished = nowIso();
  db.prepare(
    `UPDATE routine_runs SET status = ?, exit_code = ?, timed_out = ?, duration_ms = ?,
       error = ?, started_at = COALESCE(started_at, ?), finished_at = ?
     WHERE id = ?`,
  ).run(
    status,
    result.exit_code ?? null,
    result.timed_out ? 1 : 0,
    result.duration_ms ?? null,
    result.error ?? null,
    finished,
    finished,
    runId,
  );
}

function applyOutcome(db: Database, rt: RoutineRow, ok: boolean, maxFailures: number | null): void {
  const finished = nowIso();
  // Re-read: a manual run may have updated the counter since this run was enqueued.
  const cur = getRoutine(db, rt.artifact_id, rt.routine_id);
  if (!cur) return;
  const failures = ok ? 0 : cur.consecutive_failures + 1;
  const disable = maxFailures !== null && failures >= maxFailures;
  db.prepare(
    `UPDATE routines SET last_run_at = ?, consecutive_failures = ?, enabled = ?
     WHERE artifact_id = ? AND routine_id = ?`,
  ).run(finished, failures, disable ? 0 : cur.enabled, rt.artifact_id, rt.routine_id);
  if (disable) {
    appendAudit(db, {
      ts: finished,
      actor: "system",
      artifact_id: rt.artifact_id,
      version: null,
      action: "routine_auto_disabled",
      meta: { routine_id: rt.routine_id, consecutive_failures: failures },
    });
  }
}

async function executeRun(db: Database, dataDir: string, runId: number): Promise<void> {
  const run = getRunById(db, runId);
  if (!run || run.status !== "queued") return;
  const rt = getRoutine(db, run.artifact_id, run.routine_id);
  db.prepare("UPDATE routine_runs SET status = 'running', started_at = ? WHERE id = ?").run(
    nowIso(),
    runId,
  );
  if (!rt) {
    finishRun(db, runId, "failed", { error: "routine deleted" });
    return;
  }
  // A routine disabled between enqueue and start does not run (kill-switch
  // honored at execution time, not only at schedule time).
  if (!rt.enabled) {
    finishRun(db, runId, "skipped", { error: "routine disabled" });
    return;
  }
  const parsed = validateRoutineDefinition(JSON.parse(rt.definition));
  if (!parsed.ok) {
    finishRun(db, runId, "failed", { error: "invalid definition snapshot" });
    applyOutcome(db, rt, false, null);
    return;
  }
  const cmd = parsed.definition.command;
  const stateDir = join(dataDir, "routines", run.artifact_id, run.routine_id);
  mkdirSync(stateDir, { recursive: true });

  const result = await spawnIsolated(cmd.argv, {
    cwd: stateDir,
    cleanupCwd: false,
    envNames: cmd.env,
    timeoutS: cmd.timeout_s,
    stdin: JSON.stringify({
      protocol: 1,
      routine: run.routine_id,
      trigger: run.trigger,
      state_dir: stateDir,
    }),
  });
  try {
    recordRunOutputs(
      db,
      dataDir,
      {
        runId: `rt:${runId}`,
        runKind: "routine",
        artifactId: run.artifact_id,
        version: artifactVersion(db, run.artifact_id),
        name: run.routine_id,
        actor: run.triggered_by,
      },
      result,
    );
  } catch {
    /* output persistence is best effort */
  }
  const ok = !result.error && !result.timedOut && result.code === 0;
  finishRun(db, runId, ok ? "done" : "failed", {
    exit_code: result.error ? null : result.code,
    timed_out: result.timedOut,
    duration_ms: Math.round(result.duration_ms || 0),
    error: ok ? null : String(result.error ?? result.stderr ?? "non-zero exit").slice(0, ERROR_MAX),
  });
  applyOutcome(db, rt, ok, parsed.definition.budgets.max_consecutive_failures);
}
