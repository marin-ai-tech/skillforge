---
title: Start eval run
summary: Starts a trigger, compare, or ablation eval run for the skill. Use it to get metrics for a version or a holdout compare before promoting to stable.
related: getting-started/skill-evals, getting-started/eval-runs-runners, getting-started/eval-gate
---

## What it does

Enqueues trigger, compare, or ablation. Maps run_in_progress, rate_limited, runners_not_configured, no_cases.

## When to use

When you want metrics for a version or a holdout compare before promoting to stable.

## Requires

Same manage-evals rights; runners configured via SKILLFORGE_EVAL_RUNNERS_FILE.
