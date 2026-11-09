// Eval journal assembled from completed runs (no separate table).
import type { Database } from "../db.ts";
import { listChannelEntries } from "../versions/channels.ts";
import { getSuiteGate } from "./suite.ts";
import { evaluateGateCompare } from "./runs.ts";

export type JournalItem = {
  version: string;
  channel: string;
  published_at: string;
  trigger: {
    recall: number | null;
    specificity: number | null;
    accuracy: number | null;
    run_id: number;
  } | null;
  holdout: { pass_rate: number | null; run_id: number } | null;
  vs_previous: {
    against: string;
    wins_candidate: number;
    wins_baseline: number;
    ties: number;
    run_id: number;
  } | null;
  ablation: { uplift: number; tasks: number; run_id: number } | null;
  gate: "passed" | "failed" | "missing" | "not_applicable";
};

type RunRow = {
  id: number | bigint;
  kind: string;
  version: string;
  against: string | null;
  scope: string;
  status: string;
  errors: number;
  summary: string | null;
  created_at: string;
};

function triggerOf(run: RunRow | undefined): JournalItem["trigger"] {
  if (!run?.summary) return null;
  const s = JSON.parse(run.summary) as {
    recall: number | null;
    specificity: number | null;
    accuracy: number | null;
  };
  return {
    recall: s.recall,
    specificity: s.specificity,
    accuracy: s.accuracy,
    run_id: Number(run.id),
  };
}

function holdoutOf(run: RunRow | undefined): JournalItem["holdout"] {
  if (!run?.summary) return null;
  const s = JSON.parse(run.summary) as {
    candidate?: { task_pass_rate: number | null };
    tasks?: number;
    passed_with?: number;
    uplift?: number;
  };
  let pass_rate: number | null = null;
  if (run.kind === "compare") {
    pass_rate = s.candidate?.task_pass_rate ?? null;
  } else if (typeof s.tasks === "number" && s.tasks > 0 && typeof s.passed_with === "number") {
    pass_rate = s.passed_with / s.tasks;
  }
  return { pass_rate, run_id: Number(run.id) };
}

function vsPreviousOf(run: RunRow | undefined): JournalItem["vs_previous"] {
  if (!run?.summary || !run.against) return null;
  const s = JSON.parse(run.summary) as {
    wins_candidate: number;
    wins_baseline: number;
    ties: number;
  };
  return {
    against: run.against,
    wins_candidate: s.wins_candidate,
    wins_baseline: s.wins_baseline,
    ties: s.ties,
    run_id: Number(run.id),
  };
}

function ablationOf(run: RunRow | undefined): JournalItem["ablation"] {
  if (!run?.summary) return null;
  const s = JSON.parse(run.summary) as { uplift: number; tasks: number };
  return { uplift: s.uplift, tasks: s.tasks, run_id: Number(run.id) };
}

function gateStatusFor(
  gate: ReturnType<typeof getSuiteGate>,
  vRuns: RunRow[],
  v: { version: string; published_at: string },
  stableHead: string | null,
  suiteUpdated: string | null,
): JournalItem["gate"] {
  if (gate !== "required") return "not_applicable";
  const head = stableHead && stableHead !== v.version ? stableHead : null;
  // For gate status on a version: look at holdout compare vs current/appropriate stable head at time.
  const holdCmp = vRuns.find(
    (r) =>
      r.kind === "compare" &&
      r.scope === "holdout" &&
      r.status === "done" &&
      (!suiteUpdated || r.created_at > suiteUpdated) &&
      r.created_at > v.published_at,
  );
  void head;
  if (!holdCmp) return "missing";
  if (!holdCmp.summary) return "missing";
  const s = JSON.parse(holdCmp.summary) as {
    candidate: { task_pass_rate: number | null; trigger_accuracy: number | null };
    baseline: { task_pass_rate: number | null; trigger_accuracy: number | null };
  };
  const ev = evaluateGateCompare(s, holdCmp.errors);
  return ev.ok ? "passed" : "failed";
}

export function getEvalJournal(db: Database, artifactId: string): JournalItem[] {
  const versions = db
    .prepare(
      `SELECT version, channel, published_at FROM artifact_versions
       WHERE artifact_id = ? AND purged_at IS NULL
       ORDER BY published_at DESC`,
    )
    .all(artifactId) as Array<{ version: string; channel: string; published_at: string }>;

  // Semver-ish newest first: sort by version using published order from query is ok for test
  // (0.2.0 then 0.1.0). Prefer sorting by semver descending via published_at which tracks publish order.
  const gate = getSuiteGate(db, artifactId);
  const runs = db
    .prepare(
      `SELECT id, kind, version, against, scope, status, errors, summary, created_at
       FROM eval_runs WHERE artifact_id = ? AND status IN ('done', 'failed')
       ORDER BY created_at DESC, id DESC`,
    )
    .all(artifactId) as RunRow[];

  const suiteUpdated =
    (
      db.prepare("SELECT updated_at FROM eval_suites WHERE artifact_id = ?").get(artifactId) as
        { updated_at: string } | undefined
    )?.updated_at ?? null;

  const entries = listChannelEntries(db, artifactId);
  const stableHead = (() => {
    const stable = entries.filter((e) => e.channel === "stable");
    if (!stable.length) return null;
    return stable.map((e) => e.version).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))[0] ?? null;
  })();

  // Newest versions first by semver-ish string compare of version components is fragile;
  // use published_at DESC already from SQL.
  const items: JournalItem[] = [];
  for (const v of versions) {
    const vRuns = runs.filter((r) => r.version === v.version);
    const lastTrigger = vRuns.find((r) => r.kind === "trigger" && r.status === "done");
    const lastCompare = vRuns.find((r) => r.kind === "compare" && r.status === "done");
    const lastHoldoutCmp = vRuns.find(
      (r) =>
        (r.kind === "compare" || r.kind === "ablation") &&
        r.scope === "holdout" &&
        r.status === "done",
    );
    const lastAblation = vRuns.find((r) => r.kind === "ablation" && r.status === "done");

    const trigger = triggerOf(lastTrigger);
    const holdout = holdoutOf(lastHoldoutCmp);
    const vs_previous = vsPreviousOf(lastCompare);
    const ablation = ablationOf(lastAblation);
    const gateStatus = gateStatusFor(gate, vRuns, v, stableHead, suiteUpdated);

    items.push({
      version: v.version,
      channel: v.channel,
      published_at: v.published_at,
      trigger,
      holdout,
      vs_previous,
      ablation,
      gate: gateStatus,
    });
  }

  // Newest versions first by semver max order: tests expect 0.2.0 before 0.1.0.
  items.sort((a, b) => {
    // Prefer published_at DESC
    if (a.published_at !== b.published_at) return a.published_at < b.published_at ? 1 : -1;
    return a.version < b.version ? 1 : -1;
  });
  return items;
}
