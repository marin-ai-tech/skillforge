---
title: E_TOO_MANY_FILES
summary: Blocking error: the input has more than 1000 files, which exceeds the hard limit, so the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: more than 1000 files in the input. The count limit is hard. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Vendoring node_modules; huge reference trees; generated file storms. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Reduce to at most 1000 files; prefer external evidence URLs when needed. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
find . -type f | wc -l
# must be <= 1000
```
