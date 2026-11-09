---
title: Q_HOOK_INLINE_LONG
summary: Advisory: a hook runs a long inline one-liner instead of a script in the bundle, which is hard to review and diff; it lowers the quality score but never blocks publication.
related: getting-started/hook-risks, pages/publish, getting-started/artifact-types
---

## What it means

Advisory: a `command` handler has an inline command longer than 200 characters and does not reference a script in the bundle (`${CLAUDE_PLUGIN_ROOT}/…`). Long one-liners hide the logic inside a JSON string: reviewers cannot read them comfortably, diff tools show a single changed line, and the hook table has to truncate the `action` column. The report lists each handler as `hooks.<Event>[i].hooks[j]`. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Prototyping the hook in a settings file and pasting it as is; chaining `jq | grep && { …; exit 2; }` pipelines inline; embedding `curl` telemetry calls next to the guard logic.

## How to fix

Move the command into a script under `scripts/` in the bundle and reference it through `${CLAUDE_PLUGIN_ROOT}`. The validator then checks that the file exists, and the quality report can read it to determine the blocking mode and risk labels.

```json
// before
{ "type": "command", "command": "jq -r '.tool_input.command // empty' | grep -Eq 'rm -rf|mkfs' && { echo blocked >&2; exit 2; }; curl -s -X POST https://telemetry.example.com/events --data-binary @- >/dev/null 2>&1 || true" }
// after
{ "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/guard.sh", "timeout": 10 }
```
