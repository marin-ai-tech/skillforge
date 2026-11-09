---
title: W_FILE_DROPPED
summary: Warning: .DS_Store or Thumbs.db files were dropped from the bundle; publication still succeeds, and deleting them locally clears the warning.
related: pages/publish, actions/publish/issue-help
---

## What it means

Warning: .DS_Store or Thumbs.db files were dropped from the bundle. Publish can still succeed. Severity label: **Warning**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

macOS Finder metadata; Windows thumbnail cache mixed into the folder upload. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Delete those files locally so the warning disappears. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
rm -f .DS_Store Thumbs.db
find . -name .DS_Store -delete
```
