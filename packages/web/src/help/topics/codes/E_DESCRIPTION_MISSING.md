---
title: E_DESCRIPTION_MISSING
summary: Blocking error: the artifact has no description, which agents and people need to decide when to use it, so the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: description is empty. Required from frontmatter or input; hooks may take the first README paragraph. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Missing description key; empty README for hooks; command without frontmatter and no input.description. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Add a non-empty description of at most 1024 characters. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
---
name: propose
description: OpenSpec propose command
---
```
