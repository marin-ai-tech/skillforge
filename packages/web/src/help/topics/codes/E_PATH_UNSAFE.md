---
title: E_PATH_UNSAFE
summary: Blocking error: a file path is absolute, uses parent-directory segments or contains control characters, so it could leave the package root and the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: a file path is absolute, contains .., empty segments, or control characters after normalization (backslash to slash, strip ./). Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Uploading with ../ traversal; Windows drive paths like C:\x\SKILL.md; absolute Unix paths starting with /. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Use relative paths only inside the package root. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
# bad: ../etc/passwd
# good:
SKILL.md
references/guide.md
```
