---
title: E_SINGLE_FILE_REQUIRED
summary: Blocking error: a command must be published as exactly one Markdown file, so input with more or fewer files cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: command input must be exactly one .md file. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Uploading extra files with a command; selecting a skill folder for command type. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Publish commands as a single commands/<name>.md file. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
# only
propose.md
```
