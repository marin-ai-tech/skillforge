---
title: Routines
summary: How routines run a workflow or command on a cron schedule, and how to enable, disable or stop them.
section: automation
learn:
  - How the five-field cron schedule is interpreted
  - Who may save, enable and disable a routine
  - How failure counters and run-now work
  - How to stop all scheduled fires with the kill switch
related: getting-started/workflows, getting-started/run-outputs, actions/routines/routine-save, actions/routines/routine-run-now
---

A **routine** runs a workflow (or a shell command) on a cron schedule. Like
workflows, routines live on the artifact **Routines** tab and require the
orchestration contour (`SKILLFORGE_ORCHESTRATION_ENABLED`); when it is off
the tab is hidden and the API returns `403 feature_disabled`.

## Schedule syntax

The schedule is a five-field cron expression. `N/S` inside a field means
`N..max` stepping by `S` (POSIX semantics) — `5/15` in the minute field
fires at 5, 20, 35, 50. When both day-of-month and day-of-week are
restricted, the routine fires when **either** matches. Impossible schedules
(such as the 31st of February) are rejected at save time with `422`, and a
stored schedule that can never fire may show `next_run_at: null`. Use
`routine-save` to upsert the JSON definition (schedule, command or workflow
reference, budgets). **Only admin** may save, delete, or enable a routine;
owners and other manage roles can still disable (kill switch) and run
approved routines manually.

## Enable, disable, failure counters

Routines can be disabled without losing their definition; running a disabled
routine reports `skipped` instead of executing. **Enable is admin-only**;
re-enabling **resets the consecutive-failure counter**, so a fixed routine
starts clean. Any manage role can disable. `POST …/routines/:rt/run`
(`routine-run-now`) fires a routine immediately, outside its schedule, for
ad-hoc verification. `GET …/routines/runs` lists the journal of executions.

## Permissions and safety

Commands in routine definitions are admin-approved.

> [!WARNING]
> Processes run as the server OS user without filesystem isolation; the env allowlist is hygiene, not a boundary. Enable orchestration only on trusted installs — see `docs/en/18-orchestration.md`.

## Kill switch

The operator can stop all new scheduled fires by setting
`SKILLFORGE_ROUTINES_DISABLED=true` (or `1`) — the flag is read at server
startup, so restart the server to apply it. Manual run-now still works while
the switch is set.
