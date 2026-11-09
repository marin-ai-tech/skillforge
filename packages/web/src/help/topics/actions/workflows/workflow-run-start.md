---
title: Start a workflow run
summary: Starts a run of the selected workflow, executing its steps one at a time in an isolated process. Use it to run a build, check, and evaluate chain against the artifact.
related: actions/workflows/workflow-save, actions/workflows/workflow-replay
---

## What it does

Enqueues a run of the selected definition. Steps execute one at a time in an isolated process
(no shell, scrubbed environment, timeout, kill tree); each step's stdout/stderr is stored, and
the run finishes as done, failed, or cancelled at a step boundary.

## When to use

To execute the chain: build → check → evaluate style pipelines against the artifact.

## Requires

Owner, maintainer, reviewer, or admin on the artifact. One active run per server.
