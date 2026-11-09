---
title: E_NAME_INVALID
summary: Blocking error: the artifact name breaks the naming rules (lowercase letters, digits and single hyphens, up to 64 characters), so the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: artifact.name must be 1-64 characters of a-z, 0-9, and hyphen; no leading/trailing hyphen; no consecutive --. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Uppercase (PDF-Tools); spaces; underscores; empty name; name over 64 characters. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Use kebab-case like pdf-tools. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
---
name: pdf-tools
description: PDF helpers
---
```
