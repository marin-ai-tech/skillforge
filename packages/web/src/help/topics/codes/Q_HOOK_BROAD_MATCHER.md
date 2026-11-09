---
title: Q_HOOK_BROAD_MATCHER
summary: Advisory: a tool hook has no matcher or matches everything, so it runs on every tool call and multiplies latency and risk; it lowers the quality score but never blocks publication.
related: getting-started/hook-risks, pages/publish, getting-started/artifact-types
---

## What it means

Advisory: a `PreToolUse`, `PostToolUse` or `PermissionRequest` group has no `matcher`, or its matcher is `*`. Such a handler runs on every tool call in the session (`Read`, `Grep`, `Edit`, `Bash`, MCP tools), which multiplies latency and the blast radius of any mistake in the script. The report lists each handler as `hooks.<Event>[i].hooks[j]`; the hook table also marks these rows with the `every_prompt` risk label. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Leaving `matcher` out because the script filters on `tool_name` internally; using `*` "to be safe"; copying a group from an audit hook that really needs every event.

## How to fix

Name the tools the handler cares about. `matcher` is a regular expression on the tool name, so alternatives are cheap. Keep `*` only for audit or telemetry hooks and explain it in the README.

```json
// before
{ "hooks": [{ "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/guard.sh", "timeout": 5 }] }
// after
{ "matcher": "Bash|Write|Edit", "hooks": [{ "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/guard.sh", "timeout": 5 }] }
```
