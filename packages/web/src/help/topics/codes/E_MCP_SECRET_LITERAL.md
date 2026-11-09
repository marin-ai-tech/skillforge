---
title: E_MCP_SECRET_LITERAL
summary: Blocking error: a secret of the MCP server is written as a value, and everyone who can read the registry would see it.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: an environment variable, header, named argument or template variable has a literal `value` or `default` while it is marked `isSecret`, has a secret-like name (`TOKEN`, `SECRET`, `PASSWORD`, `API_KEY` and similar) or looks like a key. Values made only of `{variables}`, optionally after `Bearer`, are references, not literals. Severity label: **Blocking**.

## Common causes

Copying a personal agent config with a token in it; a default token for convenience; `Bearer` with the token itself.

## How to fix

Declare the slot without a value, or use a `{variable}`: each person sets the secret on their machine.

```json
{ "name": "Authorization", "isSecret": true, "value": "Bearer {token}", "variables": { "token": { "isSecret": true } } }
```
