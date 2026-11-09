---
title: W_UNKNOWN_FRONTMATTER_KEY
summary: Warning: a frontmatter key is not in the known set for this artifact type, which is often a typo; it may be kept, but it is flagged for review.
related: pages/publish, actions/publish/issue-help
---

## What it means

Warning: a frontmatter key is not in the known set for this type. It may be preserved but is flagged. Severity label: **Warning**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Reckon-only keys like status on a skill; typos; experimental fields. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Rename to a known key or accept the warning if the key is intentionally custom. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
---
name: nutrition-migration
description: Learned skill
---
```
