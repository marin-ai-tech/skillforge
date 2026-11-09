---
title: E_DESCRIPTION_TOO_LONG
summary: Blocking error: the description is longer than 1024 characters, so the version cannot be published until it is shortened.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: description longer than 1024 characters. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Pasting an entire README into description; generated blurbs. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Shorten to at most 1024 characters; keep detail in the markdown body. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
---
name: pdf-tools
description: Short summary under 1024 chars
---
```
