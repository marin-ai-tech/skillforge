---
title: E_PLUGIN_MCP_INVALID
summary: Blocking error: .mcp.json is not valid JSON with an mcpServers object at its root, so the plugin's MCP servers cannot be read and the version cannot be published.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: `.mcp.json` must be valid JSON whose root is an object containing an `mcpServers` object. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse.

## Common causes

Broken JSON; array root; missing `mcpServers`.

## How to fix

Provide a valid `.mcp.json` with `mcpServers` mapping server names to configs, or remove the file. Re-run validation on the Publish page and confirm the issue disappears from the issue list.

```
.claude-plugin/plugin.json
skills/<name>/SKILL.md
commands/<name>.md
agents/<name>.md
hooks/hooks.json
.mcp.json
```
