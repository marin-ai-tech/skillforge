---
title: E_PLUGIN_EMPTY
summary: Blocking error: the plugin has no skills, commands, agents, hooks or MCP servers, so installing it would do nothing and the version cannot be published.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: the plugin has no components — no skills, commands, agents, hooks, or MCP servers. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse.

## Common causes

Only README/LICENSE present; components left outside the bundle root.

## How to fix

Add at least one component under `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, or `.mcp.json`. Re-run validation on the Publish page and confirm the issue disappears from the issue list.

```
.claude-plugin/plugin.json
skills/<name>/SKILL.md
commands/<name>.md
agents/<name>.md
hooks/hooks.json
.mcp.json
```
