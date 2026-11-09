---
title: E_AGENT_ISOLATION_INVALID
summary: Blocking error: the agent's isolation key has a value other than worktree, so the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: agent isolation is set but is not the allowed value worktree. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

isolation: vm or other experimental values. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Set isolation: worktree or omit the key. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
---
name: handoff-executor
description: Executor
isolation: worktree
---
```
