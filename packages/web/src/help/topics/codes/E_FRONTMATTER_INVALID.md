---
title: E_FRONTMATTER_INVALID
summary: Blocking error: the frontmatter cannot be read as YAML or as simple key: value lines, so the artifact's fields are unknown and the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: frontmatter could not be parsed as YAML or as soft key: value lines. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Broken --- fences; binary junk; completely malformed headers. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Start the file with --- / key: value lines / --- then the markdown body. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
---
name: pdf-tools
description: Extract text from PDFs
---

# PDF tools
Body here.
```
