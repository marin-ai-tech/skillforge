---
title: E_MCP_URL_INVALID
summary: Blocking error: the remote endpoint of the MCP server is not a plain https address.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: after `{templates}` are filled in, the `url` must be `https`, carry no user name or password, no query parameter named `key`, `token`, `secret`, `password`, `auth`, `sig` or `api_key`, and not point to `localhost`, `127.0.0.1` or `*.localhost`. Severity label: **Blocking**.

## Common causes

A provider URL with the key in the query; a test server on localhost; an http address.

## How to fix

Use the https endpoint, move the key into a secret header, and validate again.

```json
{ "type": "streamable-http", "url": "https://mcp.example.com/mcp", "headers": [{ "name": "X-Api-Key", "isSecret": true }] }
```
