---
title: Lifecycle board
summary: The lifecycle board is where reviewers and admins promote, reject, revalidate, retire and restore artifacts. Use it for the full review queue and the delete-today board.
section: ui-review
learn:
  - What the review, delete-today and retired tabs show
  - How to promote or reject a candidate
  - How to revalidate or retire aging and zombie artifacts
  - How to restore a retired artifact for another review
  - Who may use the board
related: getting-started/lifecycle, pages/artifact, pages/home
---

## What this page is for

Route `/lifecycle` is the governance workspace for SkillForge statuses. Reviewers and admins promote or reject candidates, revalidate aging and zombie artifacts, retire what no longer pays for itself, and restore retired work back to candidate. Tabs stay in the `tab` query so links remain shareable. Use this page when Home awaiting-review is not enough and you need the full **What can you delete today?** board. Every transition opens a shared dialog, writes an audit event, and refreshes board counts. Viewers see a forbidden panel; anonymous users are sent to sign in.

## What you see

- Browser tab title Lifecycle · SkillForge and page help topic `pages/lifecycle`.
- Tabs `tab-review`, `tab-delete`, and `tab-retired` with `aria-selected` reflecting the active query tab.
- Review queue cards with `queue-promote` and `queue-reject` actions on candidate artifacts.
- Delete-today sections `board-aging` and `board-zombie` with `board-revalidate` and `board-retire`.
- Retired list with `board-restore`; empty sections show `empty-state`.
- Shared `transition-dialog` with reason field, confirm, cancel, and dialog help.

## Common tasks

1. Open `/lifecycle?tab=review` from the user menu `menu-lifecycle` as a reviewer or admin.
2. Promote a candidate with `queue-promote`, optionally add a reason, and confirm.
3. Reject a candidate with `queue-reject` and a required reason so status becomes retired.
4. Switch to `tab=delete` after an aging sweep and revalidate or retire aging cards.
5. Open `tab-retired` and restore an artifact when you want another review cycle.
6. Return to Home and use `home-delete-board` when aging or zombie counts are non-zero.

## Permissions

Requires a signed-in reviewer or admin. Contributors and viewers receive `lifecycle-forbidden`. Anonymous visitors are redirected to Sign in with a `next` parameter. Transitions call `POST /api/v1/artifacts/:type/:name/transitions` and are audited. The board itself is readable under the public-read rule for automation, but the UI gate still requires reviewer+.
