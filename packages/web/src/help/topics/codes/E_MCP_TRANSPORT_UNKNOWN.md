---
title: E_MCP_TRANSPORT_UNKNOWN
summary: Blocking error: SkillForge does not know how this MCP server is packaged or reached.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: `registryType` is not `npm`, `pypi` or `oci`, a package `transport.type` is not `stdio`, `streamable-http` or `sse`, or a remote `type` is not `streamable-http` or `sse`. Severity label: **Blocking**.

## Common causes

Another package registry such as `nuget`; an old transport name; `stdio` on a remote endpoint.

## How to fix

Use a supported package type and transport, and describe a hosted server under `remotes`.

```json
{ "type": "streamable-http", "url": "https://mcp.example.com/mcp" }
```
