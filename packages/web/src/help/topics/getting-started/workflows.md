---
title: Workflow
summary: How workflows run ordered steps on the server for a skill, who may define and run them, and the safety limits.
section: automation
learn:
  - How to save and validate a workflow definition
  - How runs, queue limits and replays work
  - Who may save, run and replay workflows
  - Why the orchestration contour suits only trusted installs
related: getting-started/routines, getting-started/run-outputs, actions/workflows/workflow-save, actions/workflows/workflow-run-start, actions/workflows/workflow-replay, getting-started/eval-runs-runners
---

A **workflow** is a JSON definition attached to a skill artifact: a list of
ordered steps with validated branching, executed sequentially by the
server. Workflows live on the artifact **Workflows** tab (visible only for
skills and only to contributors, and only when the operator enabled the
orchestration contour via `SKILLFORGE_ORCHESTRATION_ENABLED`; otherwise the
tab is hidden and the API answers `403 feature_disabled`).

## Definition and save

`PUT /api/v1/artifacts/:type/:name/workflows/:wf` upserts a definition
(`workflow-save`). **Only admin** may save or delete definitions; other
roles with manage rights get `403 forbidden` and a rejected `PUT` creates
nothing. The definition is validated on write — malformed JSON or bad
branching answers `422`, so the stored state is always runnable. The same
definition object is returned by `GET`, and `DELETE` removes it.

## Runs

`POST …/workflows/:wf/runs` (`workflow-run-start`) enqueues a run. At most
**10 active runs** (queued + running) per artifact — the eleventh returns
`429 queue_full`; wait or cancel before retrying. A run can be **replayed**
(`workflow-replay`): the server re-executes the same definition snapshot, so
replays are reproducible even after the definition changes. Runs write their
output to the run-outputs store — see
[Run outputs](getting-started/run-outputs).

## Gates, bounded rounds and resume

A step with `kind: "gate"` runs no command: the run stops with status `waiting` until someone who manages the artifact approves or rejects it on the Workflows tab (`POST …/workflows/runs/<id>/gates/<step>` with `decision` and an optional `reason`). Approve follows `on_success`, reject follows `on_failure`; the decision, who made it and why stay in the step row and the trace. A loop is allowed only through a step with `max_visits` (1–10): when the step has already run that many times, it is marked `exhausted` and the run follows `on_exhausted` (default `fail`). A failed or cancelled run can be resumed (`…/resume`): it continues from the step it stopped at, the count of rounds starts again and finished steps are not repeated. The `epic-with-gates` template (`GET /api/v1/workflow-templates`, `POST …/workflows/<wf>/from-template`, admin) builds plan → plan approval → implement ↔ review with `max_review_rounds` → release approval, where a rejected release goes back to implementation.

## Permissions and safety

**Commands are admin-approved code.** Only admin saves or deletes workflow
definitions. Owners, maintainers, and reviewers can list, run, cancel, and
replay approved definitions. See `docs/en/18-orchestration.md`.

> [!WARNING]
> Processes run as the server OS user with no filesystem isolation; the env allowlist is hygiene, not a security boundary. Enable the contour only on trusted installs.