---
title: E_PATH_FORBIDDEN
summary: Blocking error: the bundle contains files under .git/ or node_modules/, which are never allowed in an artifact, so the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: a path is under .git/ or node_modules/ at any level. Those directories are never allowed in an artifact bundle. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Zipping a repo including node_modules; including .git from a clone; nested dependency folders. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Exclude .git and node_modules before upload; publish only package files. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
rm -rf node_modules .git
# keep SKILL.md references/ assets/ scripts/
```
