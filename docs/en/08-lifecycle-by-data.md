# Lifecycle by data

SkillForge can move artifacts to `aging` and `zombie` from usage data, not only from validation dates, and bring
an aging artifact back to `active` when people start using it again. This page describes the rules and their
thresholds, how the rules resist manipulation, holds, dry runs, ablation evidence, the cleanup list and the CLI.
Manual transitions, the review queue and the Lifecycle board are covered in
[Lifecycle and review](07-lifecycle-and-review.md).

## What automation may and may not do

The server runs a lifecycle sweep at start, every hour, and when an admin asks for one. A sweep can only make
reversible moves:

| From | To | Rule |
|---|---|---|
| `active` | `aging` | no activity for too long (`idle_active`) |
| `aging` | `zombie` | still idle after the zombie threshold (`idle`) |
| `active` or `aging` | `zombie` | low transfer rate (`low_transfer`) or no ablation uplift (`no_ablation_uplift`) |
| `aging` | `active` | used again (`revived_by_usage`) |

Automation never retires, purges, or touches `candidate`, `retired` or `zombie` artifacts. A zombie never comes
back on its own; a reviewer revalidates it. A candidate that waits too long is not turned into a zombie either: it
stays `candidate` and is only flagged `stale_candidate` on the cleanup list (see below). At most
`SKILLFORGE_LIFECYCLE_MAX_PER_SWEEP` automatic transitions run in one sweep; the rest are reported as `deferred`
and wait for the next sweep. When several rules apply, revive wins over zombie, and zombie over aging.

## Rules

1. **Activity.** `last_activity_at` is the newest of: the publish or validation time of the latest version, the
   `used_at` of a session fact ([Session metrics](16-session-metrics.md)) and the `reported_at` of a usage report.
   An `active` artifact whose last activity is older than `SKILLFORGE_AGING_DAYS` moves to `aging`.
2. **idle.** An `aging` artifact with no activity for longer than `SKILLFORGE_ZOMBIE_IDLE_DAYS` becomes `zombie`.
3. **low_transfer.** Within the last `SKILLFORGE_ZOMBIE_WINDOW_DAYS`, once at least
   `SKILLFORGE_ZOMBIE_MIN_REPORTERS` different people have reported usage, the transfer rate (helped / uses) is
   computed with each reporter's uses capped at `SKILLFORGE_ZOMBIE_MIN_USES`. A rate below
   `SKILLFORGE_ZOMBIE_TRANSFER_RATE` makes the artifact `zombie`.
4. **no_ablation_uplift.** When the latest ablation evidence covers at least `SKILLFORGE_ABLATION_MIN_TASKS` tasks
   and its uplift is zero or negative (the skill does not help), the artifact becomes `zombie`.
5. **Revive.** An `aging` artifact returns to `active` when at least `SKILLFORGE_REVIVE_MIN_EVENTS` usage events
   arrive within `SKILLFORGE_REVIVE_WINDOW_DAYS`.

With `SKILLFORGE_DATA_LIFECYCLE=off` the data rules (2–5) are switched off and aging falls back to the latest
version's validation or publish time.

## Thresholds

All thresholds are environment variables read at start; an invalid value stops the server and names the variable.
Admins see the effective policy on `/admin/lifecycle`.

| Variable | Default | Role |
|---|---|---|
| `SKILLFORGE_DATA_LIFECYCLE` | `on` | kill switch: `off` disables the data rules and revive |
| `SKILLFORGE_AGING_DAYS` | 90 | `active` → `aging` after this many days without activity |
| `SKILLFORGE_ZOMBIE_IDLE_DAYS` | 180 | `aging` → `zombie` after this many idle days |
| `SKILLFORGE_ZOMBIE_WINDOW_DAYS` | 60 | window for the transfer-rate rule |
| `SKILLFORGE_ZOMBIE_MIN_USES` | 20 | cap on the uses counted from one reporter |
| `SKILLFORGE_ZOMBIE_MIN_REPORTERS` | 3 | distinct reporters needed before the transfer rule applies |
| `SKILLFORGE_ZOMBIE_TRANSFER_RATE` | 0.2 | transfer-rate threshold (0–1) |
| `SKILLFORGE_ZOMBIE_RETIRE_DAYS` | 30 | the cleanup list suggests retiring a zombie after this long |
| `SKILLFORGE_ABLATION_MIN_TASKS` | 10 | minimum tasks in an ablation for the uplift rule |
| `SKILLFORGE_REVIVE_WINDOW_DAYS` | 14 | window for revive |
| `SKILLFORGE_REVIVE_MIN_EVENTS` | 3 | usage events needed to revive |
| `SKILLFORGE_LIFECYCLE_MAX_PER_SWEEP` | 20 | speed limit: automatic transitions per sweep |
| `SKILLFORGE_CANDIDATE_TTL_DAYS` | 30 | a candidate older than this is flagged `stale_candidate` |

## Protection against manipulation

Any signed-in user may send usage reports (rate limited), so one person must not be able to sink or inflate an
artifact's rating:

- `low_transfer` needs several distinct reporters and caps each reporter's contribution.
- Automation only moves artifacts to `aging` or `zombie`, which a reviewer can undo; it never retires or purges.
- Owners are notified of every automatic transition, and the audit log stores the rule and the metrics behind it.
- Holds, dry runs and the kill switch give operators control.

## Holds

A hold freezes automatic transitions for one artifact, for example during a release freeze or while a suspicious
signal is investigated. Manual transitions still work.

```
PUT    /api/v1/artifacts/:type/:name/lifecycle-hold   { "until": "<ISO time>", "reason": "<text>" }
DELETE /api/v1/artifacts/:type/:name/lifecycle-hold
```

- Reviewers and admins only, and not on an artifact they own; MCP tokens are refused.
- `until` must be in the future and at most 365 days ahead; the reason needs at least 5 characters.
- While the hold is active, sweeps skip the artifact and count it under `held`.
- In the lifecycle panel on the artifact page: **Until**, the reason, **Set hold** and **Clear hold**; the panel also shows its **Data signals** (last activity, uses, transfer rate, reporters, ablation uplift) and which rule the policy would apply.

## Dry run and the policy page

- `GET /api/v1/admin/lifecycle/policy` returns the effective thresholds.
- `POST /api/v1/admin/lifecycle/sweep` runs a sweep now; with `{ "dry_run": true }` it returns the `plan` and the
  counters without writing anything.
- On `/admin/lifecycle` the **Dry run** button needs no confirmation; **Run sweep** asks for confirmation first.

The hourly scheduled sweep is always a real one.

## Ablation evidence

Ablation compares the same tasks with and without the skill. It is stored as evidence of kind `ablation` on a
version:

```json
{ "tasks": 20, "passed_with": 15, "passed_without": 11, "runner": "small" }
```

`tasks` is 1–1000; both passed counts are 0..`tasks`. The server computes and stores `uplift`, and the evidence
list shows it. Other evidence kinds refuse ablation fields. Ablation results can be added by hand on the Evidence
tab or with the CLI, or produced by eval runs ([Skill evals](17-skill-evals.md)).

## The cleanup list

`GET /api/v1/lifecycle/board` includes `cleanup` for reviewers and admins (it is empty for everyone else). It lists
zombies and artifacts the policy would act on, each with reasons (`idle`, `low_transfer`, `no_ablation_uplift`,
`stale_candidate`), the metrics behind them, and a `suggested_action` of `review` or `retire`. On the Lifecycle
board this is the **Clean up today** section (**Nothing to clean up** when empty); retiring from it opens the usual
transition dialog with the reason filled in.

## CLI

```
skillforge lifecycle [--json]
skillforge lifecycle hold <type>/<name> --until <ISO> --reason <text> [--json]
skillforge lifecycle hold <type>/<name> --off [--json]
skillforge lifecycle sweep [--dry-run] [--json]
skillforge evidence add <type>/<name>@<version> --kind ablation --url U --tasks N --passed-with M --passed-without K [--runner S] [--summary S] [--json]
```

Exit codes: 0 success, 1 validation or `not_owner`, 2 conflict or bad local flags, 3 no registry configured,
4 authentication or rights, 6 not found. Human output names the artifact and the rule codes.

## See also

- [Lifecycle and review](07-lifecycle-and-review.md)
- [Metrics dashboard](15-metrics-dashboard.md)
- [Session metrics](16-session-metrics.md)
- [Skill evals](17-skill-evals.md)
- [Orchestration](18-orchestration.md) — overhang detection uses the same ablation evidence
- [Glossary](glossary.md)
