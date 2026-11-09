---
title: E_FILE_TOO_LARGE
summary: Blocking error: a single file in the bundle is larger than 16 MiB, so the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: a single file exceeds 16 MiB. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Large PDF or binary in assets; uncompressed archives inside the package. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Split or externalize the file; each file must be at most 16 MiB. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
ls -lh assets/*
# compress or remove files over 16MiB
```
