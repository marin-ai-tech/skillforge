import type { Database } from "../db.ts";
import type { RunnerDef } from "./runner.ts";

/**
 * Cost per solved task: one cell per runner and side of the latest finished
 * compare or ablation run, with pass rate, tokens, cost and cost per solve. A sum is null when any task of the cell
 * has no data: a partial sum misleads more than an empty cell.
 */
export type CostCell = {
  runner: string;
  runner_label: string;
  model: string | null;
  agent: string | null;
  kind: string;
  version: string;
  against: string | null;
  side: string;
  run_id: number;
  finished_at: string | null;
  tasks: number;
  passed: number;
  pass_rate: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  cost_per_solve: number | null;
};

type RunRow = {
  id: number;
  runner: string;
  kind: string;
  version: string;
  against: string | null;
  finished_at: string | null;
};

type ResultRow = {
  side: string;
  passed: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  model: string | null;
};

/** Latest finished run per (runner, kind, version, against): older runs of the same comparison are superseded. */
function latestRuns(db: Database, artifactId: string): RunRow[] {
  const rows = db
    .prepare(
      `SELECT id, runner, kind, version, against, finished_at FROM eval_runs
       WHERE artifact_id = ? AND status = 'done' AND kind IN ('compare', 'ablation')
       ORDER BY id DESC`,
    )
    .all(artifactId) as RunRow[];
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = JSON.stringify([r.runner, r.kind, r.version, r.against]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sumOrNull(rows: ResultRow[], key: "input_tokens" | "output_tokens" | "cost_usd") {
  let total = 0;
  for (const r of rows) {
    const v = r[key];
    if (v === null) return null;
    total += v;
  }
  return total;
}

function commonModel(rows: ResultRow[]): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.model) counts.set(r.model, (counts.get(r.model) ?? 0) + 1);
  let best: string | null = null;
  for (const [m, n] of counts) if (best === null || n > counts.get(best)!) best = m;
  return best;
}

function cellOf(
  run: RunRow,
  side: string,
  rows: ResultRow[],
  def: RunnerDef | undefined,
): CostCell {
  const passed = rows.filter((r) => r.passed === 1).length;
  const cost = sumOrNull(rows, "cost_usd");
  return {
    runner: run.runner,
    runner_label: def?.label ?? run.runner,
    model: def?.model ?? commonModel(rows),
    agent: def?.agent ?? null,
    kind: run.kind,
    version: run.version,
    against: run.against,
    side,
    run_id: run.id,
    finished_at: run.finished_at,
    tasks: rows.length,
    passed,
    pass_rate: passed / rows.length,
    input_tokens: sumOrNull(rows, "input_tokens"),
    output_tokens: sumOrNull(rows, "output_tokens"),
    cost_usd: cost,
    cost_per_solve: cost !== null && passed > 0 ? cost / passed : null,
  };
}

function byCostPerSolve(a: CostCell, b: CostCell): number {
  if (a.cost_per_solve === null || b.cost_per_solve === null) {
    if (a.cost_per_solve !== b.cost_per_solve) return a.cost_per_solve === null ? 1 : -1;
  } else if (a.cost_per_solve !== b.cost_per_solve) {
    return a.cost_per_solve - b.cost_per_solve;
  }
  return a.runner.localeCompare(b.runner) || a.side.localeCompare(b.side);
}

export function costMatrix(db: Database, artifactId: string, runners: RunnerDef[]): CostCell[] {
  const defs = new Map(runners.map((r) => [r.id, r]));
  const read = db.prepare(
    `SELECT side, passed, input_tokens, output_tokens, cost_usd, model FROM eval_results
     WHERE run_id = ? AND case_kind = 'task' ORDER BY side, case_id`,
  );
  const cells: CostCell[] = [];
  for (const run of latestRuns(db, artifactId)) {
    const bySide = new Map<string, ResultRow[]>();
    for (const r of read.all(run.id) as ResultRow[]) {
      bySide.set(r.side, [...(bySide.get(r.side) ?? []), r]);
    }
    for (const [side, rows] of bySide) cells.push(cellOf(run, side, rows, defs.get(run.runner)));
  }
  return cells.sort(byCostPerSolve);
}
