---
title: Lifecycle statuses
summary: The five lifecycle statuses every artifact moves through and who may change them. They are the basis of review and of the delete-today board.
section: lifecycle
learn:
  - What candidate, active, aging, zombie and retired mean
  - Who may change status and how transitions are recorded
  - How the aging policy moves stale artifacts
  - How to use the delete-today board
related: getting-started/artifact-types, pages/lifecycle, actions/catalog/browse-status
---

Every artifact carries a lifecycle status used for governance and ablation. The path is **candidate** to **active** to **aging** to **zombie** to **retired**, with restore from retired back to candidate. Only a **reviewer** or admin may change status, and every transition writes an audit event. Aging policy can move stale active work to aging automatically. The product habit is asking **What can you delete today?** on the lifecycle board.

## Status meanings

- **candidate** — Newly published and awaiting review. Shown on Home under awaiting review and on `/lifecycle?tab=review`.
- **active** — Endorsed for normal use. Marketplace-style consumers should prefer active artifacts.
- **aging** — Still usable but past the aging threshold (default 90 days since last validation or publish). Appears on the delete-today board.
- **zombie** — Explicitly marked unused or stale by a reviewer. Stronger ablation signal than aging.
- **retired** — No longer recommended. Can be restored to candidate when needed.

## Who changes status

Contributors publish immutable versions that land as candidate. Reviewers and admins use the lifecycle panel on the artifact card or the `/lifecycle` board to promote, reject, age, mark zombie, retire, revalidate, or restore. Viewers see status chips but never transition buttons. Transitions require `POST /api/v1/artifacts/:type/:name/transitions` with reviewer+ auth; retired and zombie require a reason. The author of the latest version cannot promote it to active (`403 self_promotion_forbidden`): another reviewer does it. An admin may promote their own publication only with a reason, and the audit entry is marked `self_promotion` (in local single-user mode the reason is optional).

## Aging policy and validation

`SKILLFORGE_AGING_DAYS` (default 90) ages active artifacts whose latest version `validated_at` (or `published_at`) is older than the threshold. A value of `0` ages immediately for tests. Sweep runs at server start, hourly, and via admin `POST /api/v1/admin/lifecycle/sweep`. Revalidate (aging or zombie to active) refreshes `validated_at`. Reviewers can also validate a version explicitly, merging model compatibility tags and writing a validate audit event.

## Delete today board

Open `/lifecycle?tab=delete` (or Home `home-delete-board`) to see aging and zombie cards. Revalidate what still earns its keep; retire the rest with a reason. The review tab handles candidate promote/reject; the retired tab restores recent retirements. Catalog `browse-status` remains useful for filters, but the board is the governance cockpit.

## Replacing an artifact

When an artifact is outdated, point it at its successor of the same type with **Save successor** on its page (`replacement`). Whoever may publish versions of the artifact can set it, and the change goes to the audit log. The catalog card shows **Replaced**, the page links to the successor, `skillforge install` warns, and `skillforge sync` installs the successor and removes the replaced artifact unless the user's team requires it. Successors cannot form a cycle. Retire the old artifact separately when nobody needs it.
