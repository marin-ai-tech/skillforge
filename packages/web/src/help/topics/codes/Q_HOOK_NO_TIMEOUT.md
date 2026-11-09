---
title: Q_HOOK_NO_TIMEOUT
summary: Advisory: a command or http hook has no timeout, so a hanging script can block the agent loop; it lowers the quality score but never blocks publication.
related: getting-started/hook-risks, pages/publish, getting-started/artifact-types
---

## What it means

Advisory: a `command` or `http` handler in `hooks.json` has no `timeout`. A hook runs synchronously inside the agent loop, so a script that hangs (waiting on stdin, a network call that never returns) blocks the agent until the runtime gives up. The report lists each handler as `hooks.<Event>[i].hooks[j]`. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in. `prompt` and `agent` handlers are not counted: the runtime bounds them itself.

## Common causes

Copying a handler from documentation examples that omit `timeout`; assuming the runtime default is short enough; forgetting the field on `http` handlers that call an internal service.

## How to fix

Add a `timeout` in seconds to every `command` and `http` handler. Pick the smallest value the script needs; a few seconds is usually enough for a guard script.

```json
// before
{ "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/guard.sh" }
// after
{ "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/guard.sh", "timeout": 10 }
```
