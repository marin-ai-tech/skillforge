---
title: W_SKILL_MD_LONG
summary: Warning: SKILL.md exceeds 500 lines; it is still valid but hard to review, so detail belongs in references/ files.
related: pages/publish, actions/publish/issue-help
---

## What it means

Warning: SKILL.md exceeds 500 lines. Still valid but hard to review. Severity label: **Warning**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Inlining huge references; generated docs. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Move detail into references/ and link from the skill body. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
See [guide](references/guide.md) instead of pasting 600 lines.
```
