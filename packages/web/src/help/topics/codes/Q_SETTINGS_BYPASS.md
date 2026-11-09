---
title: Q_SETTINGS_BYPASS
summary: Advisory: the settings profile turns on bypassPermissions, so Claude Code skips permission prompts for tools; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types, getting-started/cli
---

## What it means

Advisory: the profile sets `permissions.defaultMode` to `bypassPermissions`, so Claude Code will skip permission prompts for tools. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

> [!WARNING]
> Everyone who applies this profile inherits `bypassPermissions`: Claude Code then runs tools on their machine without asking first.

## Common causes

Copying a power-user local config into a company baseline; intending "yolo mode" for CI runners without documenting the risk.

## How to fix

Remove `defaultMode` or set a safer mode, and keep bypass profiles clearly named and scoped. Prefer explicit `allow`/`deny` lists for team baselines.

```json
{
  "permissions": {
    "allow": ["Read", "Grep"],
    "deny": ["Bash(rm -rf:*)"]
  }
}
```
