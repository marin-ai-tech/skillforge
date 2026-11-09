---
title: Eval runs and runners
summary: How eval runs execute suite cases through operator-supplied runners, and how to read their results and errors.
section: evidence
learn:
  - What trigger, compare and ablation runs measure
  - How operators configure runner processes
  - Which limits and error codes apply to runs
  - How to wait for a run from the CLI
related: getting-started/skill-evals, getting-started/eval-gate, actions/evals/eval-run-start
---

An **eval run** executes suite cases against one or two skill versions using an operator-supplied runner process. Runs are created with `POST …/evals/runs` or `skillforge evals run`. While any run is `queued` or `running`, the Evals tab polls about every two seconds (only while the tab is open and you are signed in).

## Run kinds

**trigger** — scores trigger cases for a single version; summary exposes recall, specificity, and accuracy.

**compare** — blind A/B of a candidate `version` against `against` (default: current stable head if it differs). Case and side order are shuffled deterministically from the run id; the runner never receives version numbers or the words baseline/candidate. Summary includes per-side `task_pass_rate` / `trigger_accuracy` and `wins_candidate`, `wins_baseline`, `ties`.

**ablation** — task cases with the skill files versus without them. On a clean finish the server may attach ablation evidence to the version (`ablation_recorded`).

`scope` is `all` (default) or `holdout`. Holdout scope is what the acceptance gate expects for promote-to-stable compares.

## Operator runners

Runners are not shipped inside SkillForge. The host sets `SKILLFORGE_EVAL_RUNNERS_FILE` to JSON listing `{ id, label?, command, timeout_s?, env? }`. The server spawns `command` without a shell, allowlists environment variables (never `SKILLFORGE_*`), uses a temp cwd, and kills the process tree on timeout. Stdin is a protocol-1 JSON job; stdout must be a JSON object (or a final fenced JSON code block) with `triggered` or `output`. Missing runners → `503 runners_not_configured`. Multiple runners require an explicit runner id (`422 runner_required`).

## Limits and errors

Only one run runs per artifact at a time (`409 run_in_progress`). A daily UTC cap applies (`429 rate_limited`). Unknown version → not found. Empty matching cases → `422 no_cases`. The UI maps these codes to short operator messages next to **Start run**.

## Results and output_excerpt

Each case result stores `passed`, optional `triggered`, `error` (`timeout` / `failed` / `invalid_output`), `duration_ms`, and `output_excerpt` (≤ 500 characters). In the web UI the excerpt is rendered as **plain React text only** — never as HTML — so a malicious `<img onerror=…>` string cannot execute.

> [!WARNING]
> Treat excerpts as untrusted data when copying into other tools.

## CLI waiting

`skillforge evals run …` without `--wait` prints the run id and exits 0. With `--wait`, the CLI polls until `done` or `failed` (about ten minutes): exit 0 for done, 1 for failed; conflict while another run is active is exit 2. Use `evals runs` and `evals journal` to inspect history after the fact.

## Cost per solved task

A task answer may also carry `usage` (`input_tokens`, `output_tokens`), `cost_usd` and `model`; a runner entry in the runners file may carry `model`, `agent` and `price` (`input_per_mtok`, `output_per_mtok`, dollars per million tokens). A task costs the runner's `cost_usd` when it reports one, otherwise its tokens at the runner's price, otherwise nothing is known. Malformed fields are dropped and the task still counts.

The Evals tab shows a cost table built from the latest finished compare and ablation run of each runner: one row per runner and side, with solved tasks, tokens, cost and cost per solved task (`GET …/evals/cost`), cheapest per solved task first. A model that is cheaper per task can still cost more per solved task when it solves fewer. If any task of a row has no data, its sums are a dash rather than a partial number; with no solved tasks the cost per solved task is a dash too.
