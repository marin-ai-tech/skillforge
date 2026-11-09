---
title: E_PLUGIN_MANIFEST_INVALID
summary: Blocking error: plugin.json is not an object with a valid kebab-case name and a description, so the plugin cannot be identified and the version cannot be published.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: plugin.json must be a JSON object with kebab-case `name` (1–64) and `description` (1–1024 characters). Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse.

## Common causes

Invalid JSON; name with spaces or capitals; missing or empty description.

## How to fix

Fix the manifest fields to match Claude Code plugin naming rules and re-run validation. Re-run validation on the Publish page and confirm the issue disappears from the issue list.

```
.claude-plugin/plugin.json
skills/<name>/SKILL.md
commands/<name>.md
agents/<name>.md
hooks/hooks.json
.mcp.json
```
