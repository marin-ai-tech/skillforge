---
title: E_BUNDLE_TOO_LARGE
summary: Blocking error: the total file content exceeds the registry's 32 MiB hard limit, so the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: total file content exceeds 32 MiB. The registry hard-limits bundle size. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Large binaries in assets/; accidental inclusion of build output; videos or datasets. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Remove large files until total payload is at most 32 MiB. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
du -sh .
# strip fat assets until under 32MiB
```
