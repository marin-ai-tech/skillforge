---
title: E_MCP_POLICY
summary: Blocking error: the company's MCP policy does not allow this package type or remote origin, so the MCP server cannot be published.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: a package `registryType` is not in the policy's `registry_types`, or a remote `url` (with `{templates}` read as their names) has an origin that matches no entry of `remote_origins`. An entry `https://*.domain` matches subdomains only. By default every package type is allowed and no remote origin is. Severity label: **Blocking**.

## Common causes

A hosted MCP server nobody has approved yet; an internal image while the policy allows only public registries; a new tenant domain.

## How to fix

Ask an admin to review the origin or package type and add it on the lifecycle page (`mcp-policy`), or describe a server the policy already allows. The message names the field and the origin, never the path.

```json
{ "registry_types": ["npm", "pypi", "oci"], "remote_origins": ["https://mcp.sentry.dev", "https://*.acme.example"] }
```
