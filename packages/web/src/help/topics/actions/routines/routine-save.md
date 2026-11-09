---
title: Save routine definition
summary: Validates and stores a routine definition: its schedule, command, and budgets. Use it to schedule a recurring job on the artifact; only admins may save.
related: actions/routines/routine-run-now, actions/workflows/workflow-save
---

## What it does

Validates the JSON definition — `schedule` (`every N seconds` or 5-field UTC cron),
`command` argv with env allowlist, `budgets` — and stores it under the artifact with the
next fire time. The command runs in an isolated process inside the routine's own
persistent state directory.

## When to use

To schedule a recurring job on the artifact: metrics refresh, periodic checks, sync.
Only an **admin** may save, delete, or enable a routine; owners can still disable
(kill switch) and run approved routines manually.

## Requires

Admin for save / delete / enable. Owner, maintainer, reviewer+, or admin for disable and
manual run.
