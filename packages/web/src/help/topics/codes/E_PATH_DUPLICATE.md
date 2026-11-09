---
title: E_PATH_DUPLICATE
summary: Blocking error: two input files normalize to the same relative path, so the bundle is ambiguous and the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: two input files normalize to the same relative path. Duplicates are rejected. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Mixing ./SKILL.md and SKILL.md; repeated drag-and-drop of the same file. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Ensure each path appears once after normalization. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
# keep a single entry
SKILL.md
# not also ./SKILL.md
```
