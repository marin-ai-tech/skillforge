---
title: E_SETTINGS_JSON_INVALID
summary: Blocking error: settings.json does not parse as a JSON object, so it cannot be merged safely into Claude Code settings and the version cannot be published.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: `settings.json` must parse as a JSON object (not an array, string, or truncated file). Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse. A broken fragment cannot be merged safely into Claude Code settings.

## Common causes

Trailing commas; pasting YAML; uploading an array such as `[1, 2]`; cutting the file mid-edit; wrong encoding that inserts stray characters.

## How to fix

Validate the file with a JSON parser, ensure the root value is `{ ... }`, and re-run validation on the Publish page until the Blocking error is gone.

```json
{
  "permissions": { "allow": ["Read"] },
  "model": "opus"
}
```
