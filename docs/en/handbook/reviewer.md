# Reviewer

A reviewer decides what the organisation's agents get. They promote candidates to `active` or reject them, validate
versions against target models, and keep the delete-today board short by revalidating what still pays for itself and
retiring the rest. This chapter lists the reviewer's rights and walks through a review day.

## On this page

- [What a reviewer can do](#what-a-reviewer-can-do)
- [Start the day](#start-the-day)
- [Review a candidate](#review-a-candidate)
- [Promote or reject](#promote-or-reject)
- [Validate a version](#validate-a-version)
- [Work the delete-today board](#work-the-delete-today-board)
- [Hold an artifact](#hold-an-artifact)
- [Promote a first batch](#promote-a-first-batch)
- [Overrides and moderation](#overrides-and-moderation)
- [See also](#see-also)

## What a reviewer can do

Everything a [contributor](contributor.md) can do, plus:

| Task | Where |
|---|---|
| Promote, reject, mark aging or zombie, revalidate, retire, restore | the lifecycle panel on the artifact page, Lifecycle (`/lifecycle`) |
| Validate a version with model compatibility tags | the artifact's Versions tab |
| Set or clear a lifecycle hold | the lifecycle panel, `skillforge lifecycle hold` |
| Promote all candidates at once | First-run guide (`/start`) |
| See team artifacts of every team | catalog and artifact pages |
| Publish into someone else's artifact, add evidence there | as an audited `publish_override` |
| Delete any comment | the Comments tab |
| Turn an eval acceptance gate off | the Evals tab, `skillforge evals push … --gate off` |

A reviewer cannot manage ownership, users or policies; those belong to the owner and the [admin](admin.md).

## Start the day

1. Open **My workspace** (`/me`). The **Review queue** shows how many candidates wait.
2. Or look at **Awaiting review** on Home, and at the delete-today shortcut that appears when aging or zombie
   counts are not zero.
3. Open **Lifecycle** from the user menu: `/lifecycle?tab=review` for candidates, `?tab=delete` for aging and
   zombie artifacts, `?tab=retired` for recent retirements.

From the terminal, `skillforge lifecycle` prints the cleanup board.

## Review a candidate

Open the artifact page and read it in this order:

1. **Overview**: description, provenance, the Agents section, and the rendered main file.
2. **Quality**: the A–D grade and its checks, the security scan verdict (**pass**, **warn**, **fail**) with each
   finding's rule, file and line, the context cost, and possible duplicates. For a hook, read the risk table: event,
   matcher, type, action, timeout and the risk labels.
3. **Versions**: **Compare versions** shows the files added, removed or changed and the diff of each file since the
   previous version.
4. **Evidence**: gate, run, diff, review, eval and ablation links, and the Transfer Rate.
5. **Comments**: open questions and findings.

If the review-assistant server plugin is enabled, its run adds findings from several models with an agreement count.
Decide each finding: **Fix**, **Verify**, **Defer** with a reason, or **Reject**. A model check never changes the
status, and no findings does not mean the artifact is safe. See [Quality and security](../09-quality-and-security.md).

> [!WARNING]
> A security scan **pass** means none of the known patterns were found, not that the artifact is safe. Review still
> decides.

## Promote or reject

1. On the review tab, choose **Promote** (`queue-promote`) on the card, or the promote button in the artifact's
   lifecycle panel.
2. Add an optional reason and confirm. The status becomes `active`, the audit log records the transition, and the
   artifact appears in the marketplace, over MCP and on the Install tab.
3. To reject, choose **Reject** (`queue-reject`) and give a reason. The candidate becomes `retired`.

You cannot promote a version you published yourself: the button is disabled with a hint, and the API answers
`403 self_promotion_forbidden`. Another reviewer promotes it. An admin may promote their own publication with a
required reason, and the audit entry is marked `self_promotion`.

## Validate a version

On the **Versions** tab, choose **Validate** on a version after you evaluated it against target models. The dialog
sets `validated_at` and merges model compatibility tags, and the audit log records a validate event. Validation is
separate from the author's own `gate` evidence, which also sets `validated_at` but is self-attestation.

## Work the delete-today board

The board asks one question: what can you delete today?

| Status | What to do |
|---|---|
| `aging` | the latest version is older than the aging threshold (90 days by default) since validation or publish. **Revalidate** if it still earns its keep; otherwise **Retire** with a reason |
| `zombie` | marked unused, by a reviewer or by data rules such as low Transfer Rate. **Revalidate** or **Retire** with a reason |
| `retired` | no longer recommended. **Restore** sends it back to `candidate` for another review |

Reasons are required for `zombie` and `retired`. On an active artifact you can also choose **Mark aging** or **Mark zombie**
in its lifecycle panel. Automation never deletes files or retires anything; it moves artifacts only between
active, aging and zombie. See [Lifecycle and review](../07-lifecycle-and-review.md) and
[Lifecycle by data](../08-lifecycle-by-data.md).

## Hold an artifact

A hold freezes automatic aging and zombie transitions for one artifact while manual transitions still work. Use it
during a release freeze or while you investigate a suspicious low-transfer signal.

```bash
skillforge lifecycle hold skill/pdf-tools --until 2026-12-31T00:00:00Z --reason "release freeze"
skillforge lifecycle hold skill/pdf-tools --off
```

The end date must be in the future and within 365 days, and the reason at least five characters. The owner of an
artifact cannot hold their own work.

## Promote a first batch

After a fresh install or a starter-pack import, open the **First-run guide** (`/start`). Enter an optional reason
and confirm **Promote all candidates**. Each promoted item gets its own audit event. The page also shows the
marketplace connect command to share with your team.

## Overrides and moderation

- **Publishing into someone else's artifact** is accepted and written to the audit log as `publish_override`. Use it
  for urgent fixes; for routine work, ask the owner to add you as a maintainer.
- **Comments**: you can delete any comment. The body is cleared, replies stay, and the deletion is audited as
  `comment_delete`.
- **Eval gate**: owners can turn the acceptance gate on, but only a reviewer or admin can turn it off.
- **Holds and the board** are yours; the lifecycle policy, the sweep and the policies on `/admin/lifecycle` belong to
  admins.

## See also

- [Handbook by role](README.md) for the other roles.
- [Skill evals](../17-skill-evals.md) for holdout compare runs before stable.
- [Glossary](../glossary.md) for lifecycle terms.
- In-app help: `pages/lifecycle`, `getting-started/lifecycle`, `getting-started/hook-risks`,
  `getting-started/review-assistant`.
