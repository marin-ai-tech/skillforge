---
title: E_BODY_EMPTY
summary: Blocking error: the skill, command or agent has frontmatter but no instructions after it, so there is nothing to follow and the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: markdown body after frontmatter is empty for skill, command, or agent. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Frontmatter-only file; whitespace-only body. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Add real instructions or prompt text after the closing ---. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
---
name: propose
description: Propose a change
---

Propose an OpenSpec change with clear steps.
```
