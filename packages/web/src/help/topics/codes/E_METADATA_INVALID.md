---
title: E_METADATA_INVALID
summary: Blocking error: the skill's metadata is not a string-to-string object, so the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: skill metadata must be a string-to-string object. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Nested objects or arrays in metadata; numeric values; invalid YAML structure. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Use flat string keys and string values only. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
---
name: pdf-tools
description: PDF helpers
metadata:
  team: platform
  owner: alice
---
```
