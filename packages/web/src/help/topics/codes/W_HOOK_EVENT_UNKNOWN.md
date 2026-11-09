---
title: W_HOOK_EVENT_UNKNOWN
summary: Warning: hooks.json uses an event name outside the known Claude Code event list, often a typo, so that hook may never fire.
related: pages/publish, actions/publish/issue-help
---

## What it means

Warning: hooks.json uses an event name outside the known Claude Code event list. Severity label: **Warning**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Typos like OnCoffee; future event names not yet documented. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Use documented events such as PreToolUse or accept the warning knowingly. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
{
  "hooks": {
    "PreToolUse": []
  }
}
```
