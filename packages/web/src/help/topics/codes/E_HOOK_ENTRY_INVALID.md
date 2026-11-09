---
title: E_HOOK_ENTRY_INVALID
summary: Blocking error: a hook entry lacks the fields its type requires or has an invalid timeout, so the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: a HookEntry is missing required fields for its type or has an invalid timeout. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

type command without command field; http without url; non-positive timeout. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Fill required fields per type (command/url/prompt/agent/server+tool); use positive timeouts. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh", "timeout": 30 }
```
