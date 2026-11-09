---
title: Replay a workflow run
summary: Starts a new run with the exact definition and input of an earlier run. Use it to reproduce a run for comparison or to verify determinism.
related: actions/workflows/workflow-run-start, actions/workflows/workflow-save
---

## What it does

Creates a new run with the exact definition snapshot and input stored in the source run —
even when the current definition has changed. The new run joins the same queue and writes its
own trace and outputs.

## When to use

To reproduce a run for comparison, after fixing a step, or to verify determinism.

## Requires

Owner, maintainer, reviewer, or admin on the artifact.
