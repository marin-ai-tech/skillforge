---
title: W_NAME_FILE_MISMATCH
summary: Warning: an agent file's basename differs from the name in its frontmatter; publication can proceed, but one of the two should be renamed to match.
related: pages/publish, actions/publish/issue-help
---

## What it means

Warning: an agent file basename differs from frontmatter.name. Publish can proceed. Severity label: **Warning**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

File handoff-executor.md with name: other-agent in frontmatter. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Rename the file to <name>.md or align frontmatter.name. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
# agents/handoff-executor.md
---
name: handoff-executor
description: Executor agent
---
```
