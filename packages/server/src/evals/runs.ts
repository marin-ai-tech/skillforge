// Eval runs: enqueue, execute trigger/compare/ablation, summaries.
import semver from "semver";
import type { Database } from "../db.ts";
import type { AppConfig } from "../config.ts";
import { appendAudit, getArtifactByTypeName } from "../repo.ts";
import { readBlob } from "../blobs.ts";
import { appendEvidence, computeUplift } from "../evidence/evidence.ts";
import { listChannelEntries, latestOf } from "../versions/channels.ts";
import {
  evaluateChecks,
  getSuiteGate,
  listSuiteCases,
  type EvalCase,
  type EvalCheck,
} from "./suite.ts";
import {
  loadRunnersFile,
  runCase,
  type CaseExecResult,
  type RunnerDef,
  type SkillPayload,
} from "./runner.ts";
import { NO_USAGE, caseCost } from "./usage.ts";

export type RunKind = "trigger" | "compare" | "ablation";
export type RunScope = "all" | "holdout";
export type RunStatus = "queued" | "running" | "done" | "failed";

export type EvalResultRow = {
  case_id: string;
  side: string;
  passed: boolean;
  triggered: boolean | null;
  error: string | null;
  duration_ms: number;
  output_excerpt: string | null;
  /** cost-per-solve: set for task results only. */
  cost?: TaskCost;
};

type TaskCost = {
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  model: string | null;
};

/** Tokens and cost of one task, at the runner's price when the runner did not report a cost. */
function taskCost(runner: RunnerDef, out: CaseExecResult): TaskCost {
  const usage = out.usage ?? NO_USAGE;
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd: caseCost(usage, runner.price ?? null),
    model: usage.model,
  };
}

export type EvalRunView = {
  id: number;
  kind: RunKind;
  version: string;
  against: string | null;
  runner: string;
  scope: RunScope;
  status: RunStatus;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  errors: number;
  error: string | null;
  summary: unknown;
  results?: EvalResultRow[];
};

const MAX_FILE_BYTES = 512 * 1024;
const TEXT_EXT = /\.(md|txt|json|ya?ml|toml|js|ts|mjs|cjs|py|sh|css|html|xml|csv)$/i;

type QueueJob = {
  db: Database;
  config: AppConfig;
  dataDir: string;
  artifactId: string;
  type: string;
  name: string;
  runId: number;
};

let activeArtifact: string | null = null;
const waitQueue: QueueJob[] = [];

function utcDayStart(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleDeterministic<T>(items: T[], seedKey: string): T[] {
  const arr = items.slice();
  const rnd = mulberry32(hashSeed(seedKey));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

function isTextPath(p: string): boolean {
  return TEXT_EXT.test(p) || p.endsWith("SKILL.md") || p.includes("/SKILL.md");
}

export function loadSkillPayload(
  db: Database,
  dataDir: string,
  artifactId: string,
  artifactName: string,
  version: string,
): SkillPayload {
  const row = db
    .prepare(
      "SELECT description, files FROM artifact_versions WHERE artifact_id = ? AND version = ? AND purged_at IS NULL",
    )
    .get(artifactId, version) as { description: string; files: string } | undefined;
  if (!row) return null;
  const filesMeta = JSON.parse(row.files) as Array<{ path: string; sha256: string; size: number }>;
  const files: Array<{ path: string; content: string }> = [];
  for (const f of filesMeta) {
    if (!isTextPath(f.path)) continue;
    if (f.size > MAX_FILE_BYTES) continue;
    try {
      const bytes = readBlob(dataDir, f.sha256);
      if (bytes.byteLength > MAX_FILE_BYTES) continue;
      // Reject obvious binary (NUL).
      let binary = false;
      for (let i = 0; i < Math.min(bytes.byteLength, 1024); i++) {
        if (bytes[i] === 0) {
          binary = true;
          break;
        }
      }
      if (binary) continue;
      files.push({
        path: f.path,
        content: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
      });
    } catch {
      /* skip missing blob */
    }
  }
  return { name: artifactName, description: row.description ?? "", files };
}

function rowToRun(
  row: {
    id: number | bigint;
    kind: string;
    version: string;
    against: string | null;
    runner: string;
    scope: string;
    status: string;
    requested_by: string;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    summary: string | null;
    errors: number;
    error: string | null;
  },
  withResults: boolean,
  db?: Database,
): EvalRunView {
  const id = Number(row.id);
  const view: EvalRunView = {
    id,
    kind: row.kind as RunKind,
    version: row.version,
    against: row.against,
    runner: row.runner,
    scope: row.scope as RunScope,
    status: row.status as RunStatus,
    requested_by: row.requested_by,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    errors: row.errors,
    error: row.error,
    summary: row.summary ? JSON.parse(row.summary) : null,
  };
  if (withResults && db) {
    const results = db
      .prepare(
        "SELECT case_id, side, passed, triggered, error, duration_ms, output_excerpt FROM eval_results WHERE run_id = ? ORDER BY case_id, side",
      )
      .all(id) as Array<{
      case_id: string;
      side: string;
      passed: number;
      triggered: number | null;
      error: string | null;
      duration_ms: number;
      output_excerpt: string | null;
    }>;
    view.results = results.map((r) => ({
      case_id: r.case_id,
      side: r.side,
      passed: r.passed === 1,
      triggered: r.triggered === null ? null : r.triggered === 1,
      error: r.error,
      duration_ms: r.duration_ms,
      output_excerpt: r.output_excerpt,
    }));
  }
  return view;
}

export function getRun(db: Database, artifactId: string, runId: number): EvalRunView | null {
  const row = db
    .prepare("SELECT * FROM eval_runs WHERE id = ? AND artifact_id = ?")
    .get(runId, artifactId) as Parameters<typeof rowToRun>[0] | undefined;
  if (!row) return null;
  return rowToRun(row, true, db);
}

export function listRuns(db: Database, artifactId: string): EvalRunView[] {
  const rows = db
    .prepare("SELECT * FROM eval_runs WHERE artifact_id = ? ORDER BY created_at DESC, id DESC")
    .all(artifactId) as Array<Parameters<typeof rowToRun>[0]>;
  return rows.map((r) => rowToRun(r, false));
}

export function interruptStaleRuns(db: Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE eval_runs SET status = 'failed', error = 'interrupted by restart', finished_at = ?
     WHERE status IN ('queued', 'running')`,
  ).run(now);
}

export type EnqueueError =
  | { status: 400; error: "run_invalid" }
  | { status: 403; error: "forbidden" | "mcp_token_forbidden" }
  | { status: 401; error: "unauthorized" }
  | { status: 404; error: "not_found" }
  | { status: 409; error: "run_in_progress" }
  | { status: 422; error: string }
  | { status: 429; error: "rate_limited" }
  | { status: 503; error: "runners_not_configured" };

export type EnqueueOk = { status: 202; run: EvalRunView };

function stableHead(db: Database, artifactId: string): string | null {
  const entries = listChannelEntries(db, artifactId);
  const stable = entries.filter((e) => e.channel === "stable").map((e) => e.version);
  return stable.length ? (latestOf(entries.filter((e) => e.channel === "stable")) ?? null) : null;
}

type RunKindInput = "trigger" | "compare" | "ablation";

type RunRequest = {
  kind: RunKindInput;
  version: string;
  scope: RunScope;
  against: string | null;
  runner: string | undefined;
};

function isRunKind(kind: unknown): kind is RunKindInput {
  return kind === "trigger" || kind === "compare" || kind === "ablation";
}

function isExactSemver(version: unknown): version is string {
  return (
    typeof version === "string" && !!semver.valid(version) && semver.valid(version) === version
  );
}

function parseRunScope(raw: unknown): RunScope | null {
  const scope: RunScope = raw === undefined ? "all" : (raw as RunScope);
  return scope === "all" || scope === "holdout" ? scope : null;
}

function validOptionalAgainst(raw: unknown): boolean {
  return raw === undefined || (typeof raw === "string" && !!semver.valid(raw));
}

/** Validated run request body, or null for run_invalid. */
function parseRunRequest(body: unknown): RunRequest | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const kind = b.kind;
  if (!isRunKind(kind)) return null;
  if (!isExactSemver(b.version)) return null;
  const scope = parseRunScope(b.scope);
  if (scope === null) return null;
  if (!validOptionalAgainst(b.against)) return null;
  if (b.runner !== undefined && typeof b.runner !== "string") return null;
  return {
    kind,
    version: b.version,
    scope,
    against: typeof b.against === "string" ? b.against : null,
    runner: b.runner as string | undefined,
  };
}

function versionExists(db: Database, artifactId: string, version: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS n FROM artifact_versions WHERE artifact_id = ? AND version = ? AND purged_at IS NULL",
    )
    .get(artifactId, version);
  return !!row;
}

/** compare: explicit `against` must exist, otherwise the stable head (not the version itself). */
function resolveAgainst(
  db: Database,
  artifactId: string,
  req: RunRequest,
): { against: string | null } | EnqueueError {
  if (req.kind !== "compare") return { against: req.against };
  if (req.against === null) {
    const head = stableHead(db, artifactId);
    if (!head || head === req.version) return { status: 422, error: "against_required" };
    return { against: head };
  }
  if (!versionExists(db, artifactId, req.against)) return { status: 404, error: "not_found" };
  return { against: req.against };
}

function missingCasesError(db: Database, artifactId: string, req: RunRequest): EnqueueError | null {
  const cases = listSuiteCases(db, artifactId);
  const scoped = req.scope === "holdout" ? cases.filter((c) => c.holdout) : cases;
  // compare and ablation require task cases (acceptance: no_cases when suite is trigger-only)
  const needed = req.kind === "trigger" ? "trigger" : "task";
  if (!scoped.some((c) => c.kind === needed)) return { status: 422, error: "no_cases" };
  return null;
}

function resolveRunnerId(
  config: AppConfig,
  requested: string | undefined,
): { runnerId: string } | EnqueueError {
  const loaded = loadRunnersFile(config.evalRunnersFile);
  if (loaded.error) {
    // Invalid JSON -> run will fail later; but empty/missing at enqueue = 503 if no runners.
  }
  if (!config.evalRunnersFile || loaded.runners.length === 0) {
    return { status: 503, error: "runners_not_configured" };
  }
  if (typeof requested === "string") {
    if (!loaded.runners.some((r) => r.id === requested))
      return { status: 422, error: "runner_unknown" };
    return { runnerId: requested };
  }
  if (loaded.runners.length === 1) {
    return { runnerId: loaded.runners[0]!.id };
  }
  return { status: 422, error: "runner_required" };
}

type QueuedRunFields = {
  artifactId: string;
  actor: string;
  kind: RunKindInput;
  version: string;
  against: string | null;
  runnerId: string;
  scope: RunScope;
};

/** Inserts the queued run in one transaction (in-progress and daily limits); returns its id. */
function insertQueuedRun(
  db: Database,
  config: AppConfig,
  f: QueuedRunFields,
): number | EnqueueError {
  const now = new Date().toISOString();
  const dayStart = utcDayStart();
  let runId = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    const inProgress = db
      .prepare(
        "SELECT 1 AS n FROM eval_runs WHERE artifact_id = ? AND status IN ('queued', 'running') LIMIT 1",
      )
      .get(f.artifactId);
    if (inProgress) {
      db.exec("ROLLBACK");
      return { status: 409, error: "run_in_progress" };
    }
    const dayCount = (
      db
        .prepare("SELECT COUNT(*) AS n FROM eval_runs WHERE artifact_id = ? AND created_at >= ?")
        .get(f.artifactId, dayStart) as { n: number }
    ).n;
    if (dayCount >= config.evalMaxRunsPerDay) {
      db.exec("ROLLBACK");
      return { status: 429, error: "rate_limited" };
    }
    const info = db
      .prepare(
        `INSERT INTO eval_runs
          (artifact_id, kind, version, against, runner, scope, status, requested_by, created_at, started_at, finished_at, summary, errors, error)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, NULL, NULL, NULL, 0, NULL)`,
      )
      .run(f.artifactId, f.kind, f.version, f.against, f.runnerId, f.scope, f.actor, now);
    runId = Number(info.lastInsertRowid);
    appendAudit(db, {
      ts: now,
      actor: f.actor,
      artifact_id: f.artifactId,
      version: f.version,
      action: "eval_run",
      meta: {
        run: runId,
        kind: f.kind,
        version: f.version,
        against: f.against,
        runner: f.runnerId,
      },
    });
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
  return runId;
}

export function enqueueRun(
  db: Database,
  config: AppConfig,
  opts: {
    artifactId: string;
    type: string;
    name: string;
    actor: string;
    body: unknown;
  },
): EnqueueOk | EnqueueError {
  const req = parseRunRequest(opts.body);
  if (!req) {
    return { status: 400, error: "run_invalid" };
  }

  if (opts.type !== "skill") {
    return { status: 422, error: "type_not_supported" };
  }

  if (!versionExists(db, opts.artifactId, req.version)) return { status: 404, error: "not_found" };

  const resolved = resolveAgainst(db, opts.artifactId, req);
  if ("status" in resolved) return resolved;
  const against = resolved.against;

  const casesError = missingCasesError(db, opts.artifactId, req);
  if (casesError) return casesError;

  const runner = resolveRunnerId(config, req.runner);
  if ("status" in runner) return runner;
  const runnerId = runner.runnerId;

  const inserted = insertQueuedRun(db, config, {
    artifactId: opts.artifactId,
    actor: opts.actor,
    kind: req.kind,
    version: req.version,
    against,
    runnerId,
    scope: req.scope,
  });
  if (typeof inserted !== "number") return inserted;
  const runId = inserted;

  const run = getRun(db, opts.artifactId, runId)!;
  scheduleJob({
    db,
    config,
    dataDir: config.dataDir,
    artifactId: opts.artifactId,
    type: opts.type,
    name: opts.name,
    runId,
  });
  return { status: 202, run };
}

function scheduleJob(job: QueueJob): void {
  waitQueue.push(job);
  pumpQueue();
}

/** Hooks called after every run reaches a terminal state (eval-orchestrator batch pump). */
const runFinishedHooks: Array<(runId: number) => void> = [];
export function onRunFinished(fn: (runId: number) => void): void {
  runFinishedHooks.push(fn);
}

function pumpQueue(): void {
  if (activeArtifact !== null) return;
  const next = waitQueue.shift();
  if (!next) return;
  activeArtifact = next.artifactId;
  void executeRun(next).finally(() => {
    activeArtifact = null;
    for (const fn of runFinishedHooks) {
      try {
        fn(next.runId);
      } catch {
        /* hook errors must not break the queue */
      }
    }
    pumpQueue();
  });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function executeRun(job: QueueJob): Promise<void> {
  const { db, config, dataDir, artifactId, name, runId } = job;
  const runRow = db.prepare("SELECT * FROM eval_runs WHERE id = ?").get(runId) as
    | {
        kind: string;
        version: string;
        against: string | null;
        runner: string;
        scope: string;
        requested_by: string;
        status: string;
      }
    | undefined;
  if (!runRow || (runRow.status !== "queued" && runRow.status !== "running")) return;

  const started = new Date().toISOString();
  db.prepare("UPDATE eval_runs SET status = 'running', started_at = ? WHERE id = ?").run(
    started,
    runId,
  );

  const loaded = loadRunnersFile(config.evalRunnersFile);
  if (loaded.error || loaded.runners.length === 0) {
    finishFailed(db, runId, loaded.error ?? "runners_not_configured");
    return;
  }
  const runner = loaded.runners.find((r) => r.id === runRow.runner);
  if (!runner) {
    finishFailed(db, runId, "runner_unknown");
    return;
  }

  const allCases = listSuiteCases(db, artifactId);
  const scoped = runRow.scope === "holdout" ? allCases.filter((c) => c.holdout) : allCases;

  try {
    if (runRow.kind === "trigger") {
      await execTrigger(
        db,
        config,
        dataDir,
        artifactId,
        name,
        runId,
        runner,
        runRow.version,
        runRow.requested_by,
        scoped.filter((c) => c.kind === "trigger"),
      );
    } else if (runRow.kind === "compare") {
      await execCompare(
        db,
        config,
        dataDir,
        artifactId,
        name,
        runId,
        runner,
        runRow.version,
        runRow.against!,
        runRow.requested_by,
        scoped,
      );
    } else {
      await execAblation(
        db,
        config,
        dataDir,
        artifactId,
        name,
        runId,
        runner,
        runRow.version,
        runRow.requested_by,
        scoped.filter((c) => c.kind === "task"),
      );
    }
  } catch (e) {
    finishFailed(db, runId, String((e as Error).message ?? e));
  }
}

function finishFailed(db: Database, runId: number, error: string): void {
  db.prepare(
    "UPDATE eval_runs SET status = 'failed', error = ?, finished_at = ?, errors = 0, summary = NULL WHERE id = ?",
  ).run(error.slice(0, 2000), new Date().toISOString(), runId);
}

function insertResult(db: Database, runId: number, r: EvalResultRow): void {
  db.prepare(
    `INSERT INTO eval_results (run_id, case_id, side, passed, triggered, error, duration_ms, output_excerpt,
       case_kind, input_tokens, output_tokens, cost_usd, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    r.case_id,
    r.side,
    r.passed ? 1 : 0,
    r.triggered === null ? null : r.triggered ? 1 : 0,
    r.error,
    r.duration_ms,
    r.output_excerpt,
    r.cost ? "task" : "trigger",
    r.cost?.input_tokens ?? null,
    r.cost?.output_tokens ?? null,
    r.cost?.cost_usd ?? null,
    r.cost?.model ?? null,
  );
}

function finalizeRun(
  db: Database,
  runId: number,
  results: EvalResultRow[],
  summary: unknown,
): void {
  const errors = results.filter((r) => r.error !== null).length;
  const executed = results.some((r) => r.error !== "timeout");
  const status: RunStatus = results.length > 0 && executed ? "done" : "failed";
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of results) insertResult(db, runId, r);
    db.prepare(
      `UPDATE eval_runs SET status = ?, finished_at = ?, errors = ?, summary = ?, error = ? WHERE id = ?`,
    ).run(
      status,
      new Date().toISOString(),
      errors,
      JSON.stringify(summary),
      status === "failed" && errors === results.length
        ? "all cases timed out or none executed"
        : null,
      runId,
    );
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

async function execTrigger(
  db: Database,
  config: AppConfig,
  dataDir: string,
  artifactId: string,
  name: string,
  runId: number,
  runner: RunnerDef,
  version: string,
  actor: string,
  cases: EvalCase[],
): Promise<void> {
  const skill = loadSkillPayload(db, dataDir, artifactId, name, version);
  const ordered = shuffleDeterministic(cases, `trigger:${runId}`);
  const results = await mapPool(ordered, config.evalConcurrency, async (c) => {
    const out = await runCase(
      runner,
      { mode: "trigger", prompt: c.prompt, skill },
      {
        db,
        dataDir,
        evalRunId: runId,
        artifactId,
        version,
        actor,
        name: `${c.id}:main`,
      },
    );
    const triggered = out.error ? null : out.triggered;
    const passed = out.error === null && triggered === c.expect_trigger;
    return {
      case_id: c.id,
      side: "main",
      passed,
      triggered: triggered,
      error: out.error,
      duration_ms: out.duration_ms,
      output_excerpt: out.output_excerpt || null,
    } satisfies EvalResultRow;
  });
  // Restore case order for stable listing? Test only checks length/fields. Keep execution order is fine.
  let tp = 0,
    tn = 0,
    fp = 0,
    fn = 0;
  for (const c of cases) {
    const r = results.find((x) => x.case_id === c.id)!;
    if (r.error || r.triggered === null) continue;
    if (c.expect_trigger && r.triggered) tp++;
    else if (c.expect_trigger && !r.triggered) fn++;
    else if (!c.expect_trigger && !r.triggered) tn++;
    else fp++;
  }
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const specificity = tn + fp === 0 ? null : tn / (tn + fp);
  const accuracy = tp + tn + fp + fn === 0 ? null : (tp + tn) / (tp + tn + fp + fn);
  finalizeRun(db, runId, results, { recall, specificity, accuracy });
}

function sideStats(
  cases: EvalCase[],
  results: EvalResultRow[],
  side: string,
  version: string,
): { version: string; task_pass_rate: number | null; trigger_accuracy: number | null } {
  return {
    version,
    task_pass_rate: sideTaskPassRate(cases, results, side),
    trigger_accuracy: sideTriggerAccuracy(cases, results, side),
  };
}

function sideTaskPassRate(
  cases: EvalCase[],
  results: EvalResultRow[],
  side: string,
): number | null {
  const taskCases = cases.filter((c) => c.kind === "task");
  let taskPass = 0;
  let taskN = 0;
  for (const c of taskCases) {
    const r = results.find((x) => x.case_id === c.id && x.side === side);
    if (!r) continue;
    taskN++;
    if (r.passed) taskPass++;
  }
  return taskN === 0 ? null : taskPass / taskN;
}

function sideTriggerAccuracy(
  cases: EvalCase[],
  results: EvalResultRow[],
  side: string,
): number | null {
  const triggerCases = cases.filter((c) => c.kind === "trigger");
  let tp = 0,
    tn = 0,
    _fp = 0,
    _fn = 0,
    trigN = 0;
  for (const c of triggerCases) {
    const r = results.find((x) => x.case_id === c.id && x.side === side);
    if (!r || r.error || r.triggered === null) continue;
    trigN++;
    if (c.expect_trigger && r.triggered) tp++;
    else if (c.expect_trigger && !r.triggered) _fn++;
    else if (!c.expect_trigger && !r.triggered) tn++;
    else _fp++;
  }
  return trigN === 0 ? null : (tp + tn) / trigN;
}

async function execCompare(
  db: Database,
  config: AppConfig,
  dataDir: string,
  artifactId: string,
  name: string,
  runId: number,
  runner: RunnerDef,
  candidateVer: string,
  baselineVer: string,
  actor: string,
  cases: EvalCase[],
): Promise<void> {
  const candSkill = loadSkillPayload(db, dataDir, artifactId, name, candidateVer);
  const baseSkill = loadSkillPayload(db, dataDir, artifactId, name, baselineVer);
  type Job = { case: EvalCase; side: "candidate" | "baseline"; skill: SkillPayload };
  const jobs: Job[] = [];
  for (const c of cases) {
    jobs.push({ case: c, side: "candidate", skill: candSkill });
    jobs.push({ case: c, side: "baseline", skill: baseSkill });
  }
  const ordered = shuffleDeterministic(jobs, `compare:${runId}`);
  const results = await mapPool(ordered, config.evalConcurrency, async (job) => {
    const mode = job.case.kind === "trigger" ? "trigger" : "task";
    const sideVersion = job.side === "candidate" ? candidateVer : baselineVer;
    const out = await runCase(
      runner,
      { mode, prompt: job.case.prompt, skill: job.skill },
      {
        db,
        dataDir,
        evalRunId: runId,
        artifactId,
        version: sideVersion,
        actor,
        name: `${job.case.id}:${job.side}`,
      },
    );
    if (job.case.kind === "trigger") {
      const triggered = out.error ? null : out.triggered;
      const passed = out.error === null && triggered === job.case.expect_trigger;
      return {
        case_id: job.case.id,
        side: job.side,
        passed,
        triggered,
        error: out.error,
        duration_ms: out.duration_ms,
        output_excerpt: out.output_excerpt || null,
      } satisfies EvalResultRow;
    }
    const output = out.output ?? "";
    const passed = out.error === null && evaluateChecks(output, job.case.checks as EvalCheck[]);
    return {
      case_id: job.case.id,
      side: job.side,
      passed,
      triggered: null,
      error: out.error,
      duration_ms: out.duration_ms,
      output_excerpt: out.output_excerpt || null,
      cost: taskCost(runner, out),
    } satisfies EvalResultRow;
  });

  const candidate = sideStats(cases, results, "candidate", candidateVer);
  const baseline = sideStats(cases, results, "baseline", baselineVer);
  let wins_candidate = 0,
    wins_baseline = 0,
    ties = 0;
  for (const c of cases.filter((x) => x.kind === "task")) {
    const cr = results.find((r) => r.case_id === c.id && r.side === "candidate")!;
    const br = results.find((r) => r.case_id === c.id && r.side === "baseline")!;
    if (cr.passed === br.passed) ties++;
    else if (cr.passed) wins_candidate++;
    else wins_baseline++;
  }
  finalizeRun(db, runId, results, { candidate, baseline, wins_candidate, wins_baseline, ties });
}

async function execAblation(
  db: Database,
  config: AppConfig,
  dataDir: string,
  artifactId: string,
  name: string,
  runId: number,
  runner: RunnerDef,
  version: string,
  actor: string,
  cases: EvalCase[],
): Promise<void> {
  const withSkill = loadSkillPayload(db, dataDir, artifactId, name, version);
  type Job = { case: EvalCase; side: "with" | "without"; skill: SkillPayload };
  const jobs: Job[] = [];
  for (const c of cases) {
    jobs.push({ case: c, side: "with", skill: withSkill });
    jobs.push({ case: c, side: "without", skill: null });
  }
  const ordered = shuffleDeterministic(jobs, `ablation:${runId}`);
  const results = await mapPool(ordered, config.evalConcurrency, async (job) => {
    const out = await runCase(
      runner,
      { mode: "task", prompt: job.case.prompt, skill: job.skill },
      {
        db,
        dataDir,
        evalRunId: runId,
        artifactId,
        version,
        actor,
        name: `${job.case.id}:${job.side}`,
      },
    );
    const output = out.output ?? "";
    const passed = out.error === null && evaluateChecks(output, job.case.checks as EvalCheck[]);
    return {
      case_id: job.case.id,
      side: job.side,
      passed,
      triggered: null,
      error: out.error,
      duration_ms: out.duration_ms,
      output_excerpt: out.output_excerpt || null,
      cost: taskCost(runner, out),
    } satisfies EvalResultRow;
  });

  const tasks = cases.length;
  let passed_with = 0;
  let passed_without = 0;
  for (const c of cases) {
    if (results.find((r) => r.case_id === c.id && r.side === "with")?.passed) passed_with++;
    if (results.find((r) => r.case_id === c.id && r.side === "without")?.passed) passed_without++;
  }
  const uplift = computeUplift(tasks, passed_with, passed_without);
  const errors = results.filter((r) => r.error !== null).length;
  const ablation_recorded = errors === 0;
  const summary = { tasks, passed_with, passed_without, uplift, ablation_recorded };

  const executed = results.some((r) => r.error !== "timeout");
  const status: RunStatus = results.length > 0 && executed ? "done" : "failed";
  const finished = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const r of results) insertResult(db, runId, r);
    if (ablation_recorded) {
      appendEvidence(
        db,
        artifactId,
        version,
        {
          kind: "ablation",
          url: `/api/v1/artifacts/skill/${name}/evals/runs/${runId}`,
          summary: null,
          data: {
            tasks,
            passed_with,
            passed_without,
            uplift,
            runner: runner.id,
          },
        },
        actor,
        finished,
      );
    }
    db.prepare(
      `UPDATE eval_runs SET status = ?, finished_at = ?, errors = ?, summary = ?, error = ? WHERE id = ?`,
    ).run(
      status,
      finished,
      errors,
      JSON.stringify(summary),
      status === "failed" ? "all cases timed out or none executed" : null,
      runId,
    );
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

export function findFreshHoldoutCompare(
  db: Database,
  artifactId: string,
  version: string,
  against: string,
  publishedAt: string,
  suiteUpdatedAt: string,
): {
  run: {
    id: number;
    errors: number;
    summary: {
      candidate: { task_pass_rate: number | null; trigger_accuracy: number | null };
      baseline: { task_pass_rate: number | null; trigger_accuracy: number | null };
    };
  };
} | null {
  const row = db
    .prepare(
      `SELECT id, errors, summary, created_at FROM eval_runs
       WHERE artifact_id = ? AND kind = 'compare' AND version = ? AND against = ?
         AND scope = 'holdout' AND status = 'done'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(artifactId, version, against) as
    { id: number | bigint; errors: number; summary: string; created_at: string } | undefined;
  if (!row) return null;
  if (row.created_at <= publishedAt || row.created_at <= suiteUpdatedAt) return null;
  return {
    run: {
      id: Number(row.id),
      errors: row.errors,
      summary: JSON.parse(row.summary) as {
        candidate: { task_pass_rate: number | null; trigger_accuracy: number | null };
        baseline: { task_pass_rate: number | null; trigger_accuracy: number | null };
      },
    },
  };
}

export function evaluateGateCompare(
  summary: {
    candidate: { task_pass_rate: number | null; trigger_accuracy: number | null };
    baseline: { task_pass_rate: number | null; trigger_accuracy: number | null };
  },
  errors: number,
): { ok: true } | { ok: false; reason: "errors" | "task_regression" | "trigger_regression" } {
  if (errors > 0) return { ok: false, reason: "errors" };
  const cTask = summary.candidate.task_pass_rate;
  const bTask = summary.baseline.task_pass_rate;
  if (cTask !== null && bTask !== null && cTask < bTask) {
    return { ok: false, reason: "task_regression" };
  }
  const cTrig = summary.candidate.trigger_accuracy;
  const bTrig = summary.baseline.trigger_accuracy;
  if (cTrig !== null && bTrig !== null && cTrig < bTrig) {
    return { ok: false, reason: "trigger_regression" };
  }
  return { ok: true };
}

// silence unused import warning for getArtifactByTypeName if not used
void getArtifactByTypeName;
void getSuiteGate;
