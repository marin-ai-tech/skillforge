---
title: First-run guide
summary: The first-run guide is a checklist for reviewers and admins after a fresh install. It walks through sign-in, a starter pack, batch promotion of candidates and connecting the marketplace.
section: ui-review
learn:
  - What the four checklist steps mean
  - How an admin installs a starter pack
  - How to promote all candidates in one batch
  - Where to copy the marketplace connect command
related: pages/home, pages/lifecycle, getting-started/starter-packs, getting-started/install
---

## What this page is for

Route `/start` is the first-run checklist for reviewers and admins. Use it after a fresh SkillForge install to sign in with a sufficient role, install a starter pack from the UI (admin), batch-promote candidate artifacts to active with per-item audit, and copy marketplace connect commands that include the registry URL. Home remains the catalog overview; Lifecycle remains the full governance board. This page closes the guided first-run path without changing single-artifact transitions or expanding starter-pack install beyond admin.

## What you see

- Document title First-run guide and page help topic `pages/start`.
- Checklist with stable step ids `signed_in`, `starter_installed`, `candidates_promoted`, and `connect_ready`, each showing done, todo, or blocked status.
- Starter packs list with Install controls for admins, one row per pack (CodeAlive, ECC essentials): install one or both, the other is not touched; reviewers see guidance that install needs admin.
- Batch promote section listing candidate count, optional reason, and Promote all candidates with a ConfirmDialog.
- Connect commands section with the marketplace add command and CopyButton.
- Forbidden panel when the signed-in role is below reviewer.

## Common tasks

1. Open `/start` from the nav link as a reviewer or admin after local-start.
2. Confirm the checklist shows `signed_in` as done for your session.
3. As admin, Install a starter pack and read the created/exists/failed summary.
4. Enter an optional reason, confirm Promote all candidates, and watch checklist `candidates_promoted` update.
5. Copy the `/plugin marketplace add <url>` command from the connect section (`start-copy-connect`).
6. Optionally open Lifecycle or run `skillforge doctor` for deeper diagnostics.

## Permissions

Requires a signed-in reviewer or admin. Viewers and contributors see a forbidden message and cannot run install or batch promote. Starter-pack install calls `POST /api/v1/admin/starter-packs/:id/install` and remains admin-only. Batch promote calls `POST /api/v1/lifecycle/batch-transitions` for reviewer+ and writes one audit event per successful item. Anonymous users are redirected to Sign in with a `next` parameter.
