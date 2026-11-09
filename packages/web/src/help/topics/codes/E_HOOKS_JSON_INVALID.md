---
title: E_HOOKS_JSON_INVALID
summary: Blocking error: hooks.json is not valid JSON or lacks the expected hooks object, so the hooks cannot be read and the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: hooks.json is not valid JSON or lacks the expected hooks object shape. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Trailing commas; comments; wrong top-level shape. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Validate JSON; top-level object must contain a hooks map of events to groups. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
{
  "hooks": {
    "PreToolUse": [
      { "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/guard.sh" }] }
    ]
  }
}
```
