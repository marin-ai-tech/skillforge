---
title: E_MCP_SHELL
summary: Blocking error: the MCP server would start through a shell, which runs whatever the string says.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: `runtimeHint` is a shell (`sh`, `bash`, `zsh`, `cmd`, `powershell`, `pwsh`), or an argument `value` or `default` contains shell syntax (`;`, `|`, `&&`, a backtick, `$(`). Severity label: **Blocking**.

## Common causes

Wrapping the launch in `bash -c`; piping a download into a shell; chaining a setup step before the server.

## How to fix

Launch the package directly with its runtime (`npx`, `uvx`, `docker`) and pass plain arguments.

```json
{ "registryType": "npm", "identifier": "tickets-mcp", "version": "1.2.3", "runtimeHint": "npx", "transport": { "type": "stdio" } }
```
