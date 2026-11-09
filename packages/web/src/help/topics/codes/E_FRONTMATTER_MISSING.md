---
title: E_FRONTMATTER_MISSING
summary: Blocking error: the required frontmatter block is missing, so the artifact's name and description cannot be read and the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: required frontmatter block is missing (skills without ---; agents missing required fence/keys). Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Plain markdown skill without YAML header; agent file without frontmatter. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Add a --- frontmatter block with required keys such as name and description. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
---
name: handoff-executor
description: Hands-on executor
model: sonnet
---

You are the executor.
```
