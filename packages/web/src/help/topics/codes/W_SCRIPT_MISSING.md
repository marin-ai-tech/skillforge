---
title: W_SCRIPT_MISSING
summary: Warning: a hook command references a script under the plugin root that is not in the bundle, so the command will fail when it runs.
related: pages/publish, actions/publish/issue-help
---

## What it means

Warning: a command references ${CLAUDE_PLUGIN_ROOT}/<relative> but that file is not in the bundle. Severity label: **Warning**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Forgot scripts/guard.sh; wrong relative path. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Add the script file to the package at the referenced relative path. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
# hooks.json command
${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh
# include scripts/guard.sh in upload
```
