---
title: E_HOOKS_JSON_MISSING
summary: Blocking error: the hook package has no hooks.json at its root, so there are no hooks to install and the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: hook packages must include hooks.json at the root after stripping a shared top folder. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Uploading only scripts/; wrong type; misnamed hooks.js. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Add hooks.json (canonicalized to hooks/hooks.json) plus scripts and README as needed. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
hooks.json
scripts/guard.sh
README.md
```
