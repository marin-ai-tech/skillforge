---
title: E_MCP_JSON_INVALID
summary: Blocking error: the MCP server has no usable `server.json`, so nothing says how to run or reach it.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: `server.json` is missing next to `MCP.md`, is not a JSON object, or lists neither `packages` nor `remotes`. A package also needs an `identifier`, and `tools` must be a list of `name` and `description`. Severity label: **Blocking**.

## Common causes

Publishing only `MCP.md`; a JSON syntax error; an empty `packages` list left from a template.

## How to fix

Add `server.json` with at least one package or one remote endpoint and validate again.

```json
{
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@modelcontextprotocol/server-github",
      "version": "2025.4.8",
      "transport": { "type": "stdio" }
    }
  ]
}
```
