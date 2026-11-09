---
title: Run outputs
summary: Where the output of server-side workflow, routine and eval runs is stored, and how to read it when a run fails.
section: evidence
learn:
  - How to list and read stored run outputs
  - Which size limits and retention apply
  - How purge affects run outputs
  - Why run output is treated as untrusted text
related: getting-started/workflows, getting-started/routines, getting-started/hooks-runtime, getting-started/eval-runs-runners
---

Executions that run on the server — workflow runs, routine fires and eval
runner invocations — write their stdout/stderr streams to the **run-outputs
store** instead of dropping them. Each record belongs to an artifact and
stores the stream kind, byte size, creation time and the truncated payload.

## Reading outputs

`GET /api/v1/artifacts/:type/:name/run-outputs` lists records for an
artifact (newest first, filtered by run/kind); `GET …/run-outputs/:id`
returns the metadata and `GET …/run-outputs/:id/content` streams the stored
payload. Output is useful for diagnosing why a workflow step or runner job
failed without server filesystem access.

## Bounds and retention

Two operator limits keep the store bounded:
`SKILLFORGE_RUN_OUTPUT_MAX_BYTES` (default 1 MiB) caps each stream — larger
output is **truncated**, with the stored record still marking the cut — and
`SKILLFORGE_RUN_OUTPUT_RETENTION_DAYS` (default 30) sets how long the
sweeper keeps records; `0` keeps them forever.

## Interaction with purge

Purging an artifact version stops further writes to its outputs: the writer
rereads `purged_at` before persisting, so a purge racing an in-flight run
cannot leave orphaned rows. Existing rows are cleaned with the artifact's
data; what remains readable is always consistent with the catalog state.

## Trust note

> [!WARNING]
> Run output is untrusted text produced by host-side commands — the web UI
> renders it as plain text only, never as HTML. Apply the same care when
> copying excerpts into terminals or tickets.
