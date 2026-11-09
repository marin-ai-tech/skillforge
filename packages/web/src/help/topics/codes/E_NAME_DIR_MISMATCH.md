---
title: E_NAME_DIR_MISMATCH
summary: Blocking error: the skill's frontmatter name differs from the name of its directory, so the version cannot be published until the two match.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: for skills with a root directory, frontmatter.name must equal that directory name (rootDir). Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Folder pdf-tools/ but name: pdf-utils in SKILL.md. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Rename the folder or the name field so they match. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
pdf-tools/SKILL.md with
---
name: pdf-tools
description: Tools for PDFs
---
```
