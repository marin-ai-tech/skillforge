---
title: E_NAME_MISMATCH
summary: Blocking error: the name given when publishing differs from the name found in the package, so the version cannot be published until they agree.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: input.name was provided and does not match the name derived from the package (except hooks where input.name is primary). Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Form name field disagrees with frontmatter.name; CLI flag vs file content mismatch. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Make the form or API name identical to the derived package name. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
# form name=pdf-tools and frontmatter name: pdf-tools
```
