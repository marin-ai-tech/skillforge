---
title: W_FRONTMATTER_LOOSE
summary: Warning: the frontmatter is not valid YAML and was read line by line instead; publication may still succeed, but values can be read differently than you meant.
related: pages/publish, actions/publish/issue-help
---

## What it means

Warning: YAML frontmatter was invalid, so the parser fell back to line-based key: value parsing. Publish may still succeed. Severity label: **Warning**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Unquoted colons in values; mixed indentation; complex YAML unsupported by the soft parser. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Quote values or simplify frontmatter so strict YAML parses cleanly. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
---
name: nutrition-migration
description: "migrate: nutrition subsystem"
---
```
