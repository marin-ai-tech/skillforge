import type { Database } from "../db.ts";
import { commonModel, sumOrNull, type ResultRow } from "./cost.ts";
import type { RunnerDef } from "./runner.ts";

/**
 * evals-summary: one row per eval runtime across the registry, from the latest finished ablation run of each
 * non-purged artifact on that runtime. Ablation runs the same tasks with and without the skill, so the rows compare
 * agents and models on equal terms; compare runs (versions) and trigger runs do not belong here.
 */
export type SummaryRow = {
  runner: string;
  runner_label: string;
  agent: string | null;
  model: string | null;
  artifacts: number;
  tasks: number;
  passed_with: number;
  passed_without: number;
  pass_rate_with: number;
  pass_rate_without: number;
  uplift: number;
  cost_usd: number | null;
  cost_per_solve: number | null;
};

type Row = ResultRow & { runner: string; artifact_id: string; run_id: number };

type Group = { artifacts: Set<string>; with: Row[]; without: Row[] };

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Task results of the latest ablation run per (artifact, runner); no parameter grows with the registry. */
function latestAblationResults(db: Database): Row[] {
  return db
    .prepare(
      `WITH latest AS (
         SELECT id, runner, artifact_id FROM (
           SELECT r.id, r.runner, r.artifact_id,
                  ROW_NUMBER() OVER (PARTITION BY r.artifact_id, r.runner ORDER BY r.id DESC) AS rn
           FROM eval_runs r JOIN artifacts a ON a.id = r.artifact_id
           WHERE r.status = 'done' AND r.kind = 'ablation' AND a.purged_at IS NULL
         ) WHERE rn = 1
       )
       SELECT l.runner, l.artifact_id, e.run_id, e.side, e.passed, e.input_tokens, e.output_tokens,
              e.cost_usd, e.model
       FROM latest l JOIN eval_results e ON e.run_id = l.id
       WHERE e.case_kind = 'task'`,
    )
    .all() as Row[];
}

function groupByRunner(rows: readonly Row[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    let g = groups.get(r.runner);
    if (!g) {
      g = { artifacts: new Set(), with: [], without: [] };
      groups.set(r.runner, g);
    }
    g.artifacts.add(r.artifact_id);
    if (r.side === "with") g.with.push(r);
    else if (r.side === "without") g.without.push(r);
  }
  return groups;
}

function toRow(runner: string, g: Group, def: RunnerDef | undefined): SummaryRow {
  const tasks = g.with.length;
  const passedWith = g.with.filter((r) => r.passed === 1).length;
  const passedWithout = g.without.filter((r) => r.passed === 1).length;
  const cost = sumOrNull(g.with, "cost_usd");
  return {
    runner,
    runner_label: def?.label ?? runner,
    agent: def?.agent ?? null,
    model: def?.model ?? commonModel(g.with),
    artifacts: g.artifacts.size,
    tasks,
    passed_with: passedWith,
    passed_without: passedWithout,
    pass_rate_with: round3(passedWith / tasks),
    pass_rate_without: round3(passedWithout / tasks),
    uplift: round3((passedWith - passedWithout) / tasks),
    cost_usd: cost,
    cost_per_solve: cost !== null && passedWith > 0 ? cost / passedWith : null,
  };
}

/** Best pass rate with the skill first, then cheaper per solved task (unknown last), then by runner id. */
function compareRows(a: SummaryRow, b: SummaryRow): number {
  if (a.pass_rate_with !== b.pass_rate_with) return b.pass_rate_with - a.pass_rate_with;
  if (a.cost_per_solve !== b.cost_per_solve) {
    if (a.cost_per_solve === null) return 1;
    if (b.cost_per_solve === null) return -1;
    return a.cost_per_solve - b.cost_per_solve;
  }
  return a.runner.localeCompare(b.runner);
}

export function evalsSummary(
  db: Database,
  runners: RunnerDef[],
): { items: SummaryRow[]; runs: number } {
  const rows = latestAblationResults(db);
  const defs = new Map(runners.map((r) => [r.id, r]));
  const items = [...groupByRunner(rows)]
    .filter(([, g]) => g.with.length > 0)
    .map(([runner, g]) => toRow(runner, g, defs.get(runner)))
    .sort(compareRows);
  return { items, runs: new Set(rows.map((r) => r.run_id)).size };
}
