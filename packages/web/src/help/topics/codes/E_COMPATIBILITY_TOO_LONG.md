---
title: E_COMPATIBILITY_TOO_LONG
summary: Blocking error: the skill's compatibility string is longer than 500 characters, so the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: skill frontmatter compatibility string exceeds 500 characters. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Pasting long model matrices into compatibility. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Keep compatibility between 1 and 500 characters; use model_compat on the version for lists. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
---
name: pdf-tools
description: PDF helpers
compatibility: claude-4-sonnet
---
```
