# Lifecycle and review

Every artifact carries a lifecycle status that says whether people should use it. This page explains the five
statuses, which transitions are allowed and who may make them, how a reviewer works through the review queue,
the rule that stops authors from approving their own work, and the Lifecycle board with its "What can you
delete today?" view. Automatic transitions driven by usage data are covered in
[Lifecycle by data](08-lifecycle-by-data.md). In-app help: `getting-started/lifecycle`.

## Statuses

| Status | Meaning | In MCP and the marketplace |
|---|---|---|
| `candidate` | newly published, waiting for review | no |
| `active` | endorsed for normal use | yes |
| `aging` | still usable, but not revalidated for a long time (90 days by default) | no |
| `zombie` | marked as unused or stale; a stronger signal to remove it than aging | no |
| `retired` | no longer recommended | no |

Status belongs to the artifact, not to a version. The first publish of a name creates the artifact as
`candidate`; later versions do not change the status. To try a new version on volunteers before everyone gets
it, publish it to the `beta` channel ([Versions and channels](10-versions-and-channels.md)).

Install commands on the Install tab and in the Claude Code marketplace are shown only for `active` artifacts.
Direct archive downloads still work for other statuses.

## Allowed transitions

| From | To |
|---|---|
| `candidate` | `active` (promote), `retired` (reject) |
| `active` | `aging`, `zombie`, `retired` |
| `aging` | `active` (revalidate), `zombie`, `retired` |
| `zombie` | `active` (revalidate), `retired` |
| `retired` | `candidate` (restore) |

Any other move is refused with `409 invalid_transition`. A move to `retired` or `zombie` needs a reason of 1–500
characters (`reason_required`); for other moves the reason is optional. Revalidating an `aging` or `zombie`
artifact back to `active` also sets `validated_at` on its latest version, which restarts the aging clock.

Every transition writes an audit event with the old and new status, the actor and the reason, notifies its
owner, maintainers and watchers and refreshes the marketplace. Server plugins receive it as the event
`artifact.transitioned` ([Server plugins](14-plugins.md)).

## Who may change status

Only a `reviewer` or `admin` may change status. Contributors publish; viewers see status chips but no transition
buttons. Transitions are made in the lifecycle panel on the artifact page, on the Lifecycle board, or through the
API:

```bash
curl -X POST "$SKILLFORGE_URL/api/v1/artifacts/skill/release-notes/transitions" \
  -H "Authorization: Bearer $SKILLFORGE_TOKEN" -H "Content-Type: application/json" \
  -d '{"to":"active","reason":"Checked against the release checklist"}'
```

`POST /api/v1/lifecycle/batch-transitions` applies several transitions in one call and reports a result per item.

### No self-promotion

The author of the latest version cannot promote it to `active`. A reviewer who tries gets
`403 self_promotion_forbidden`; another reviewer has to do it. An admin may promote their own publication only
with a reason, and the audit entry is marked `self_promotion`. In local single-user mode the reason is optional,
but the entry is still marked. Automatic transitions are not affected by this rule.

## Reviewing a candidate

A new candidate appears on Home under awaiting review and on the Review tab of the Lifecycle board. Before you
promote it, open the artifact page and check:

1. **Overview and Files** — does the description say when to use it and when not to? Is the content what the name
   promises?
2. **Quality** — the advisory score and grade, the security scan verdict and findings, the context cost and, for a
   hook, the risk table ([Quality and security](09-quality-and-security.md)).
3. **Versions** — for a new version of an existing artifact, use **Compare versions** to read the file diff.
4. **Evidence and Evals** — eval runs, ablation reports and usage evidence, if the author attached any
   ([Skill evals](17-skill-evals.md)).
5. **Comments** — open questions from other people.
6. **Review assistant** — findings from independent models, when the plugin is installed; decide each one with
   Fix, Verify, Defer or Reject ([Quality and security](09-quality-and-security.md#review-assistant)).

Then promote with a short reason, or reject: rejecting moves the candidate to `retired` and needs a reason. A
rejected artifact can be restored to `candidate` later for another round.

### Validating a version

On the Versions tab a reviewer can **validate** a version after checking it against target models. The validate
dialog takes a comma-separated list of model ids, merged into the version's `model_compat` without duplicates,
and an optional note stored as the audit reason. Validation sets `validated_at`, so a validated artifact does not
age.

## The Lifecycle board

The board lives at `/lifecycle` (user menu **Lifecycle**, reviewers and admins). The tab is kept in the `tab`
query parameter, so links can be shared.

| Tab | Shows | Actions |
|---|---|---|
| Review (`?tab=review`) | the candidate queue | promote, reject |
| Delete today (`?tab=delete`) | the "What can you delete today?" board: `aging` and `zombie` cards | revalidate, retire |
| Retired (`?tab=retired`) | recent retirements | restore to `candidate` |

Above the tabs, **Clean up today** lists artifacts with a reason to act: zombies, artifacts the data rules would
move to `aging` or `zombie`, and candidates that have waited longer than `SKILLFORGE_CANDIDATE_TTL_DAYS`
(30 by default, reason `stale_candidate`). Each row shows the rule codes and metrics and a suggested action;
retiring from this list pre-fills the reason. Home shows aging and zombie counts with a link to the board when
they are not zero.

Every action opens the same dialog with the from and to statuses and a reason field; Confirm stays disabled until
a reason is present for `retired` and `zombie`. The CLI shows the same cleanup list:

```bash
skillforge lifecycle            # cleanup board, reviewer or admin
skillforge lifecycle --json
```

The board API (`GET /api/v1/lifecycle/board`) follows the public-read rule, so automation can read it; the page
itself requires a reviewer.

## Aging

`SKILLFORGE_AGING_DAYS` (default 90) moves an `active` artifact to `aging` when its latest version was last
validated, or published, longer ago than that. The sweep runs at server start, every hour, and when an admin
calls `POST /api/v1/admin/lifecycle/sweep`. Usage-based zombie and revive rules, the policy page and dry runs are
described in [Lifecycle by data](08-lifecycle-by-data.md). Automation never retires or purges anything: only a
reviewer retires.

## Holds

A hold freezes automatic aging and zombie transitions for one artifact, for example during a release freeze or
while you investigate a suspicious signal. Manual transitions still work.

- Only reviewers and admins may set or clear a hold, and not on an artifact they own.
- `until` must be a future time within 365 days; the reason needs at least five characters.
- The active hold, its author and expiry are shown in the lifecycle panel.

```bash
skillforge lifecycle hold skill/release-notes --until 2026-12-31T00:00:00Z --reason "Release freeze"
skillforge lifecycle hold skill/release-notes --off
```

## Replacing an artifact

When an artifact is outdated, point it at its successor of the same type with **Save successor** on its page.
Anyone who may publish versions of the artifact can set it, the change is audited, and successors cannot form a
cycle. The catalog card shows **Replaced**, `skillforge install` warns, and `skillforge sync` installs the
successor and removes the replaced artifact unless the user's team requires it. Retire the old artifact
separately when nobody needs it. Details are in [Versions and channels](10-versions-and-channels.md#replacing-an-artifact).

## Roles at a glance

| Action | viewer | contributor | reviewer | admin |
|---|---|---|---|---|
| See status | yes | yes | yes | yes |
| Publish a version (lands as `candidate` for a new artifact) | no | yes | yes | yes |
| Promote, reject, age, mark zombie, retire, restore | no | no | yes | yes |
| Promote your own latest version | no | no | no | with a reason |
| Set or clear a hold (not on your own artifact) | no | no | yes | yes |
| Open `/admin/lifecycle` and run a sweep | no | no | no | yes |

## See also

- [Lifecycle by data](08-lifecycle-by-data.md) — usage-driven aging, zombie and revive rules.
- [Reviewer handbook](handbook/reviewer.md) — a reviewer's daily routine.
- [Quality and security](09-quality-and-security.md) — what the Quality tab tells you.
