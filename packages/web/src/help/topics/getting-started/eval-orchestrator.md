---
title: Eval orchestrator
summary: How the eval orchestrator queues eval runs into batches and starts ablations automatically after a publish.
section: evidence
learn:
  - How batches differ from single eval runs
  - When an ablation batch starts automatically
  - Which operator settings the orchestrator depends on
related: getting-started/eval-runs-runners, getting-started/eval-gate, getting-started/ablation-report, actions/evals/eval-run-start
---

The **eval orchestrator** turns single eval runs into managed **batches**:
a queue of runs for an artifact with single-flight semantics, so a suite
never has two active runs at once. Batches are listed and created under
`GET|POST /api/v1/artifacts/:type/:name/evals/batches` and inspected via
`GET …/evals/batches/:id`; progress surfaces in the Evals tab journal.

## Batches versus single runs

A single `evals/runs` call already refuses concurrency per artifact
(`409 run_in_progress`) and counts against the daily cap
(`SKILLFORGE_EVAL_MAX_RUNS_PER_DAY`, `429 rate_limited`). A batch applies
the same rules to a **set** of runs — the orchestrator schedules children
one at a time and reports an aggregate verdict when they finish, instead of
each caller racing the lock.

## Automatic ablation

With `SKILLFORGE_EVAL_ABLATION_AUTO=true`, publishing a skill version
automatically enqueues an ablation batch — provided
`SKILLFORGE_EVAL_RUNNERS_FILE` is configured and the artifact's suite has a
task case to run. Children consume the same daily eval limit, so automated
ablations cannot starve manual runs. A clean ablation finish can attach
`ablation_recorded` evidence to the version (see
[Ablation report](getting-started/ablation-report)).

## Operators

Runner definitions are operator-supplied processes, spawned without a
shell, with an allowlisted environment (never `SKILLFORGE_*`) and a temp
cwd — see [Eval runs and runners](getting-started/eval-runs-runners) for the
runner file format and the job protocol.

> [!IMPORTANT]
> The orchestrator itself is part of the orchestration contour and is disabled together with it when `SKILLFORGE_ORCHESTRATION_ENABLED` is unset.