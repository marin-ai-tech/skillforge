---
title: W_REFERENCE_MISSING
summary: Warning: the body links to files under scripts/, references/ or assets/ that are not in the bundle, so those links will be broken for users.
related: pages/publish, actions/publish/issue-help
---

## What it means

Warning: body links to scripts/, references/, or assets/ paths that are not in the bundle. Severity label: **Warning**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Forgot to add references/guide.md; typo in relative link. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Add the missing file or fix the link path. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
# SKILL.md body
Read [guide](references/guide.md)
# add references/guide.md to the upload
```
