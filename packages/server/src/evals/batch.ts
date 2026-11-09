// Eval orchestrator.
// A batch fans a suite out across runners: each runner becomes a sequential
// child eval_runs row (link in eval_batch_runs) driven by the existing
// single-flight queue — the pump enqueues the next child only when the
// previous one is terminal. Finished batches carry summary.saturation
// (every case passed in every completed run => suite is saturated).
import semver from "semver";
import type { Database } from "../db.ts";
import type { AppConfig } from "../config.ts";
import { appendAudit } from "../repo.ts";
import { loadRunnersFile } from "./runner.ts";
import { enqueueRun, onRunFinished } from "./runs.ts";

export type BatchRow = {
  id: number;
  artifact_id: string;
  version: string;
  kind: string;
  scope: string;
  against: string | null;
  runners: string;
  status: "queued" | "running" | "done" | "failed";
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  summary: string | null;
  error: string | null;
};

export type BatchView = Omit<BatchRow, "runners" | "summary"> & {
  runners: string[];
  summary: unknown;
};

const TERMINAL = new Set(["done", "failed"]);
const TICK_MS = 1000;

export function toBatchView(row: BatchRow): BatchView {
  let runners: string[] = [];
  try {
    const r = JSON.parse(row.runners) as unknown;
    if (Array.isArray(r)) runners = r.filter((x): x is string => typeof x === "string");
  } catch {
    /* keep [] */
  }
  let summary: unknown = null;
  try {
    summary = row.summary ? JSON.parse(row.summary) : null;
  } catch {
    /* keep null */
  }
  return { ...row, runners, summary };
}

/** After a restart no batch can resume mid-flight — children were interrupted too. */
export function interruptStaleBatches(db: Database): void {
  db.prepare(
    `UPDATE eval_batches SET status = 'failed', finished_at = ?, error = 'interrupted by restart'
     WHERE status IN ('queued','running')`,
  ).run(new Date().toISOString());
}

export function listBatches(db: Database, artifactId: string): BatchRow[] {
  return db
    .prepare("SELECT * FROM eval_batches WHERE artifact_id = ? ORDER BY id DESC LIMIT 100")
    .all(artifactId) as unknown as BatchRow[];
}

export function getBatch(db: Database, artifactId: string, id: number): BatchRow | undefined {
  return db
    .prepare("SELECT * FROM eval_batches WHERE artifact_id = ? AND id = ?")
    .get(artifactId, id) as BatchRow | undefined;
}

function childRunIds(db: Database, batchId: number): number[] {
  return (
    db
      .prepare("SELECT run_id FROM eval_batch_runs WHERE batch_id = ? ORDER BY run_id")
      .all(batchId) as Array<{ run_id: number | bigint }>
  ).map((r) => Number(r.run_id));
}

export function batchChildren(db: Database, batchId: number): unknown[] {
  const ids = childRunIds(db, batchId);
  if (!ids.length) return [];
  const marks = ids.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT id, kind, version, against, runner, scope, status, requested_by, created_at,
              started_at, finished_at, errors, error, summary
       FROM eval_runs WHERE id IN (${marks}) ORDER BY id`,
    )
    .all(...ids) as unknown[];
}

export type CreateBatchError =
  | { status: 400; error: "batch_invalid" }
  | { status: 404; error: "not_found" }
  | { status: 422; error: string }
  | { status: 503; error: "runners_not_configured" };

export type CreateBatchOk = { status: 202; batch: BatchView };

function shapeError(b: Record<string, unknown>): CreateBatchError | null {
  const kindOk = b.kind === "trigger" || b.kind === "compare" || b.kind === "ablation";
  const versionOk = typeof b.version === "string" && semver.valid(b.version) === b.version;
  const scopeOk = b.scope === undefined || b.scope === "all" || b.scope === "holdout";
  return kindOk && versionOk && scopeOk ? null : { status: 400, error: "batch_invalid" };
}

function resolveRunners(
  configured: Array<{ id: string }>,
  requested: unknown,
): { runnerIds: string[] } | CreateBatchError {
  if (requested === undefined) return { runnerIds: configured.map((r) => r.id) };
  if (
    !Array.isArray(requested) ||
    requested.length === 0 ||
    !requested.every((r) => typeof r === "string")
  ) {
    return { status: 422, error: "runners_invalid" };
  }
  const known = new Set(configured.map((r) => r.id));
  return requested.every((r: string) => known.has(r))
    ? { runnerIds: requested }
    : { status: 422, error: "runner_unknown" };
}

export function createBatch(
  db: Database,
  config: AppConfig,
  opts: {
    artifactId: string;
    type: string;
    name: string;
    actor: string;
    body: unknown;
    /** auto:true marks batches created by ablation-runner (auto on publish). */
    auto?: boolean;
  },
): CreateBatchOk | CreateBatchError {
  if (typeof opts.body !== "object" || opts.body === null || Array.isArray(opts.body)) {
    return { status: 400, error: "batch_invalid" };
  }
  const b = opts.body as Record<string, unknown>;
  const err = shapeError(b);
  if (err) return err;
  const kind = b.kind as string;
  const version = b.version as string;
  const scope = (b.scope as string | undefined) ?? "all";
  if (opts.type !== "skill") return { status: 422, error: "type_not_supported" };
  const versionRow = db
    .prepare(
      "SELECT 1 AS n FROM artifact_versions WHERE artifact_id = ? AND version = ? AND purged_at IS NULL",
    )
    .get(opts.artifactId, version);
  if (!versionRow) return { status: 404, error: "not_found" };

  const loaded = loadRunnersFile(config.evalRunnersFile);
  if (!config.evalRunnersFile || loaded.runners.length === 0) {
    return { status: 503, error: "runners_not_configured" };
  }
  const resolved = resolveRunners(loaded.runners, b.runners);
  if ("error" in resolved) return resolved;
  const runnerIds = resolved.runnerIds;

  const info = db
    .prepare(
      `INSERT INTO eval_batches
        (artifact_id, version, kind, scope, against, runners, status, requested_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    )
    .run(
      opts.artifactId,
      version,
      kind,
      scope,
      typeof b.against === "string" ? b.against : null,
      JSON.stringify(runnerIds),
      opts.actor,
      new Date().toISOString(),
    );
  const id = Number(info.lastInsertRowid);
  appendAudit(db, {
    ts: new Date().toISOString(),
    actor: opts.actor,
    artifact_id: opts.artifactId,
    version,
    action: "eval_batch",
    meta: { batch: id, kind, runners: runnerIds, ...(opts.auto ? { auto: true } : {}) },
  });
  setImmediate(pumpBatches);
  return { status: 202, batch: toBatchView(getBatch(db, opts.artifactId, id)!) };
}

type BatchCtx = { db: Database; config: AppConfig; dataDir: string };
let ctx: BatchCtx | null = null;
let timer: NodeJS.Timeout | null = null;

export function startBatchPump(db: Database, config: AppConfig): void {
  ctx = { db, config, dataDir: config.dataDir };
  stopBatchPumpTimer();
  timer = setInterval(pumpBatches, TICK_MS);
  timer.unref();
  onRunFinished(() => setImmediate(pumpBatches));
}

function stopBatchPumpTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function stopBatchPump(): void {
  stopBatchPumpTimer();
  ctx = null;
}

function childStatus(db: Database, batchId: number): { pending: string[]; anyActive: boolean } {
  const links = db
    .prepare("SELECT run_id, runner FROM eval_batch_runs WHERE batch_id = ?")
    .all(batchId) as Array<{ run_id: number | bigint; runner: string }>;
  const active = db
    .prepare(
      `SELECT r.runner FROM eval_batch_runs br JOIN eval_runs r ON r.id = br.run_id
       WHERE br.batch_id = ? AND r.status IN ('queued','running')`,
    )
    .get(batchId);
  const doneRunners = new Set(links.map((l) => l.runner));
  const batch = db.prepare("SELECT runners FROM eval_batches WHERE id = ?").get(batchId) as {
    runners: string;
  };
  const wanted = JSON.parse(batch.runners) as string[];
  return { pending: wanted.filter((r) => !doneRunners.has(r)), anyActive: !!active };
}

function finishBatch(db: Database, batch: BatchRow): void {
  const children = batchChildren(db, batch.id) as Array<{
    runner: string;
    status: string;
    errors: number;
    summary: string | null;
  }>;
  const failed = children.filter((c) => c.status === "failed");
  const done = children.filter((c) => c.status === "done");
  const runners: Record<string, unknown> = {};
  for (const c of children) {
    runners[c.runner] = {
      status: c.status,
      errors: c.errors,
      summary: c.summary ? JSON.parse(c.summary) : null,
    };
  }
  const summary = { runners, saturation: saturationOf(db, batch.id, done.length) };
  const status = failed.length ? "failed" : "done";
  const error = failed.length
    ? `child runs failed: ${failed.map((c) => c.runner).join(", ")}`
    : null;
  db.prepare(
    "UPDATE eval_batches SET status = ?, finished_at = ?, summary = ?, error = ? WHERE id = ?",
  ).run(status, new Date().toISOString(), JSON.stringify(summary), error, batch.id);
}

/** Per-case pass status: a case is saturated when it passed in EVERY done child run. */
function saturationOf(
  db: Database,
  batchId: number,
  doneRuns: number,
): { evaluated_runs: number; saturated_cases: string[]; saturated: boolean } {
  const rows = db
    .prepare(
      `SELECT res.case_id, res.passed, res.run_id
       FROM eval_results res
       JOIN eval_batch_runs br ON br.run_id = res.run_id
       JOIN eval_runs r ON r.id = res.run_id AND r.status = 'done'
       WHERE br.batch_id = ?`,
    )
    .all(batchId) as Array<{ case_id: string; passed: number; run_id: number }>;
  const byCase = new Map<string, { total: number; passed: number }>();
  for (const r of rows) {
    const e = byCase.get(r.case_id) ?? { total: 0, passed: 0 };
    e.total += 1;
    e.passed += r.passed ? 1 : 0;
    byCase.set(r.case_id, e);
  }
  const saturatedCases = [...byCase.entries()]
    .filter(([, e]) => e.total >= doneRuns && e.passed === e.total)
    .map(([id]) => id);
  const allCases = byCase.size > 0 && saturatedCases.length === byCase.size;
  return {
    evaluated_runs: doneRuns,
    saturated_cases: saturatedCases.sort(),
    saturated: doneRuns >= 2 && allCases,
  };
}

/** Enqueue the next pending child when nothing of this batch is in flight. */
function pumpOne(db: Database, config: AppConfig, batch: BatchRow): void {
  const children = batchChildren(db, batch.id) as Array<{ status: string }>;
  const anyActive = children.some((c) => !TERMINAL.has(c.status));
  const { pending } = childStatus(db, batch.id);
  if (!anyActive && pending.length === 0) {
    finishBatch(db, batch);
    return;
  }
  if (anyActive || pending.length === 0) return;
  const art = db.prepare("SELECT name, type FROM artifacts WHERE id = ?").get(batch.artifact_id) as
    { name: string; type: string } | undefined;
  const nextRunner = pending[0];
  if (!art || nextRunner === undefined) return;
  const res = enqueueRun(db, config, {
    artifactId: batch.artifact_id,
    type: art.type,
    name: art.name,
    actor: batch.requested_by,
    body: {
      kind: batch.kind,
      version: batch.version,
      against: batch.against ?? undefined,
      scope: batch.scope,
      runner: nextRunner,
    },
  });
  if (res.status === 202) {
    db.prepare("INSERT INTO eval_batch_runs (batch_id, run_id, runner) VALUES (?, ?, ?)").run(
      batch.id,
      Number(res.run.id),
      nextRunner,
    );
    if (batch.status === "queued") {
      db.prepare("UPDATE eval_batches SET status = 'running', started_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        batch.id,
      );
    }
    return;
  }
  if (res.status === 409) return; // someone else holds the queue — retry next tick
  // The daily run limit (429 rate_limited) is reported as budget_exhausted.
  const error = res.status === 429 ? "budget_exhausted" : String(res.error);
  db.prepare(
    "UPDATE eval_batches SET status = 'failed', finished_at = ?, error = ? WHERE id = ?",
  ).run(new Date().toISOString(), error, batch.id);
}

export function pumpBatches(): void {
  if (!ctx) return;
  const { db, config } = ctx;
  try {
    const rows = db
      .prepare("SELECT * FROM eval_batches WHERE status IN ('queued','running') ORDER BY id")
      .all() as unknown as BatchRow[];
    for (const b of rows) pumpOne(db, config, b);
  } catch {
    /* a pump tick must never kill the server */
  }
}
