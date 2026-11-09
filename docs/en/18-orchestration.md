# Orchestration

SkillForge can run commands on the server host on behalf of artifacts: **workflows** (ordered steps with
branching, approval gates and bounded review loops), **routines** (workflows or commands on a cron schedule), the
**hook runtime** (hook entries evaluated against tool calls), **run outputs** (the stored stdout and stderr), and
the **eval orchestrator** (eval batches across runners). **Overhang** detection reports artifacts the model no
longer needs. This page is the operator guide: the security model, the switches, and each capability. In-app help:
`getting-started/workflows`, `getting-started/routines`, `getting-started/hooks-runtime`,
`getting-started/run-outputs`, `getting-started/overhang`, `getting-started/eval-orchestrator`.

## Security model

Workflow steps, routine commands, hook entries and eval runners all start processes on the SkillForge host as the
**server's operating-system user**, with **no file-system isolation**. Therefore:

- **Off by default.** Workflows, routines and the hook runtime are disabled unless the operator sets
  `SKILLFORGE_ORCHESTRATION_ENABLED=true`. There is no API toggle: the flag is read from the environment at start
  and shown read-only in `GET /api/v1/health` (`orchestration_enabled`). While it is off, every workflow, routine
  and hook endpoint answers `403 feature_disabled`, the routine scheduler does not start, and the Workflows and
  Routines tabs are hidden. Eval runs need their own runners file (see below) and do not depend on this flag.
- **Commands are admin-only.** Saving or deleting workflow and routine definitions, building a workflow from a
  template, and enabling a routine require the `admin` role; a refused write creates nothing. Owners, maintainers
  and reviewers may still **list, run, cancel, replay and resume** approved workflows and **disable or run**
  approved routines, so whoever notices harm can stop it. Hook subscriptions are created and deleted by admins only.
  Hook **evaluation** needs a contributor or higher: a viewer cannot fire host commands, even indirectly.
- **Trust model.** Orchestration commands are code approved by an admin. Enable orchestration **only on trusted
  installations** where every admin is trusted with full access to the host. Contributors cannot escalate by saving
  their own commands.
- **No MCP tokens.** Hook evaluation and the overhang endpoints refuse MCP tokens (`403 mcp_token_forbidden`).
  Machine tokens are for reading artifacts, not for triggering execution on the host or reading operator
  diagnostics.
- **The environment allowlist is hygiene, not a boundary.** Processes get only allowlisted environment variables
  (never `SKILLFORGE_*`; the filter ignores case) and a temporary working directory, but they still share the host
  file system and the server account. Do not treat this as isolation.

## Operator switches

| Variable | Default | Effect |
|---|---|---|
| `SKILLFORGE_ORCHESTRATION_ENABLED` | off | master switch for workflows, routines and the hook runtime (API, scheduler and UI tabs) |
| `SKILLFORGE_ROUTINES_DISABLED` | unset | `true` or `1` stops new scheduled routine runs; a manual run still works. Read at start (restart to apply) |
| `SKILLFORGE_HOOKS_DISABLED` | unset | `true` or `1` makes hook evaluation answer `allow` without running or auditing entries. Read at start (restart to apply) |
| `SKILLFORGE_HOOK_TIMEOUT_S` | `10` | default timeout of one hook entry, in seconds (1–600) |
| `SKILLFORGE_RUN_OUTPUT_RETENTION_DAYS` | `30` | run outputs older than this are deleted; `0` keeps them forever |
| `SKILLFORGE_RUN_OUTPUT_MAX_BYTES` | `1048576` | cap per stored stream; longer output is truncated |
| `SKILLFORGE_EVAL_RUNNERS_FILE` | unset | JSON file with the eval and ablation runners (required for eval runs) |
| `SKILLFORGE_EVAL_ABLATION_AUTO` | `false` | queue an ablation batch for each published skill version; its runs count against the daily eval cap |
| `SKILLFORGE_EVAL_MAX_RUNS_PER_DAY` | `20` | daily eval runs per artifact, per UTC day (`429 rate_limited`) |

## Workflows

A **workflow** is a JSON definition attached to an artifact: ordered steps with validated branching. It is managed
with `PUT|GET|DELETE /api/v1/artifacts/:type/:name/workflows/:wf` and on the artifact's Workflows tab. The definition
is validated when saved (`422` on schema or branching errors).

`POST …/workflows/:wf/runs` queues a run on the server, which executes the steps in order. A run can be replayed
(executed again from the same definition snapshot) or cancelled. At most 10 runs per artifact may be queued or
running at once; the next one gets `429 queue_full`.

### Gates, bounded rounds and resume

- **Gate step.** A step with `kind: "gate"` has no command and runs nothing: the run stops with status `waiting`
  until someone who manages the artifact decides on the Workflows tab or with
  `POST …/workflows/runs/:id/gates/:step` `{ "decision": "approve" | "reject", "reason"? }` (reason up to 500
  characters). A viewer gets `403`; a run that is not waiting on that step gets `409 not_waiting`. Approve follows
  `on_success`, reject follows `on_failure`; the decision, who made it and the reason are kept on the step.
- **Bounded rounds.** A `command` step may set `max_visits` (1–10) and `on_exhausted` (a step id, `end` or `fail`;
  default `fail`). A definition with a loop that has no step with `max_visits` is refused with `422`. A step that
  has already run `max_visits` times is not executed again: it is marked `exhausted` and the run follows
  `on_exhausted`.
- **Resume.** `POST …/workflows/runs/:id/resume` on a `failed` or `cancelled` run continues from the step where it
  stopped (`202`); finished steps are not repeated, and visit counts start again. Any other run gets
  `409 not_stopped`.
- **Template `epic-with-gates`.** `GET /api/v1/workflow-templates` lists it. `POST …/workflows/:wf/from-template`
  (admin only) with `{ "template": "epic-with-gates", "commands": { "plan", "implement", "review" },
  "max_review_rounds"? }` (each command an argv array; rounds default to 3) builds: plan → plan approval →
  implement ↔ review with bounded rounds → release approval, where a rejected release goes back to implementation.
  The result is validated and saved like any other definition (audit `workflow_save`).

## Routines

A **routine** runs a workflow or a command on a cron schedule. It is managed under
`…/artifacts/:type/:name/routines/:rt` and on the Routines tab.

- **Cron.** Five fields. `N/S` in a field means `N..max` in steps of `S` (POSIX), so `5/15` in the minute field
  fires at 5, 20, 35 and 50. When both day-of-month and day-of-week are restricted, the routine fires when
  **either** matches (POSIX). Impossible schedules, such as February 31, are refused when saved (`422`); a stored
  schedule that can never fire has `nextRunAt: null`.
- **Failure counter.** A routine counts consecutive failures; `enable` resets the counter. Running a disabled
  routine returns `skipped` instead of executing it.
- **Kill switch.** `SKILLFORGE_ROUTINES_DISABLED=true` (or `1`) stops new scheduled runs after a restart;
  `POST …/routines/:rt/run` (run now) still works.
- **Run journal.** `GET …/routines/runs` lists executions with status, duration and error.

## Hook runtime

Hook artifacts (type `hook`) declare shell entries that the runtime can evaluate against tool calls. Subscriptions
(`GET|POST /api/v1/hooks/subscriptions`) bind entries to matchers; a subscription can be disabled without losing its
history.

- **Evaluation.** `POST /api/v1/hooks/evaluate` — contributors and above, no MCP tokens. It runs the matching
  entries with their timeout (falling back to `SKILLFORGE_HOOK_TIMEOUT_S`) and returns the merged decision
  (`allow`, `ask` or `block`) with a per-entry audit.
- **Windows.** A hook command runs through `cmd.exe /d /s /c` with the whole command passed unchanged, so quoted
  paths and a data folder with spaces work, and a **blocking** entry stops publishing as on other systems. Write
  the command for `cmd.exe`.
- **The audit is append-only.** `GET /api/v1/hooks/decisions` lists decisions. Deleting a subscription that already
  produced decisions (`DELETE /api/v1/hooks/subscriptions/:id`) answers `409 has_decisions`; disable it instead. The
  audit trail is never destroyed.
- **Kill switch.** `SKILLFORGE_HOOKS_DISABLED=true` (or `1`) makes evaluation answer `allow` without running or
  auditing anything.
- **Publish gate.** Hook artifacts pass a publish gate on their normalised type and name, checked after the publish
  request is parsed, so empty or padded fields cannot get around it. The same gate guards imports.

## Run outputs

Workflow, routine and runner executions write their stdout and stderr to the run-output store
(`GET …/artifacts/:type/:name/run-outputs`, `…/run-outputs/:id`, `…/run-outputs/:id/content`). Reading them needs the
right to manage the artifact's evals. Each stream is capped by `SKILLFORGE_RUN_OUTPUT_MAX_BYTES`, and old outputs are
deleted after `SKILLFORGE_RUN_OUTPUT_RETENTION_DAYS`. Output of a purged artifact version is not written: the writer
checks for a purge just before storing, so a purge during a run leaves no rows pointing at erased content.

## Overhang detection

**Overhang** flags artifacts whose data suggests the model has outgrown them: for example, ablation shows the skill
adds no measurable uplift, so the model already does the job without it. `GET /api/v1/lifecycle/overhang` lists the
candidates and `GET /api/v1/artifacts/:type/:name/overhang` computes the report for one artifact. Both need a
reviewer or admin and refuse MCP tokens. Candidates are chosen from **ablation evidence** (for example
`no_ablation_uplift`, with the threshold `SKILLFORGE_ABLATION_MIN_TASKS`), not from recent edits, so a quiet but
well-proven artifact is still reported. See [Lifecycle by data](08-lifecycle-by-data.md) for the same rule in the
automatic lifecycle.

## Eval orchestrator

The eval orchestrator (`…/evals/batches`) queues eval batches across several runners, one run at a time per
artifact, within the daily run cap. With `SKILLFORGE_EVAL_ABLATION_AUTO=true`, a published skill version
automatically queues an ablation batch (this needs `SKILLFORGE_EVAL_RUNNERS_FILE` and a task case in the suite); its
runs count against the same daily cap. Batch progress and verdicts appear in the Evals tab journal. Runners are
processes supplied by the operator, under the security model above; the runners file and the protocol are described
in [Skill evals](17-skill-evals.md).

## Recommended rollout

1. Keep orchestration off until you need it; `feature_disabled` is the safe answer.
2. Set `SKILLFORGE_ORCHESTRATION_ENABLED=true` only on trusted installations, where the admins who define
   orchestration commands are trusted with the server's operating-system account. Contributors can run approved
   definitions but cannot invent commands.
3. Use `SKILLFORGE_ROUTINES_DISABLED` and `SKILLFORGE_HOOKS_DISABLED` as reversible kill switches during an
   incident: set `true` (or `1`) and restart the server; the values are read at start.

## See also

- [Self-hosting](03-self-hosting.md) — environment variables
- [Skill evals](17-skill-evals.md)
- [Lifecycle by data](08-lifecycle-by-data.md)
- [Artifact types](05-artifact-types.md) — hooks
- [Quality and security](09-quality-and-security.md)
- [Admin handbook](handbook/admin.md)
