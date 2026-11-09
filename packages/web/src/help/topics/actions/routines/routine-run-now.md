---
title: Run a routine now
summary: Runs a routine immediately, outside its schedule, counting toward its daily budget. Use it to test a routine before trusting its schedule or to force a pass.
related: actions/routines/routine-save, actions/workflows/workflow-run-start
---

## What it does

Enqueues a manual run of the routine, outside its schedule. The run counts toward the
daily budget; when `max_runs_per_day` is exhausted the request is rejected with
`budget_exhausted`. Output streams land in run outputs (`rt:<id>`).

## When to use

To test a routine before trusting its schedule, or to force an immediate pass.

## Requires

Owner, maintainer, reviewer, or admin on the artifact.
