---
title: E_MCP_UNPINNED
summary: Blocking error: an MCP package runs without a fixed version, so every machine may run different code than the one reviewed.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: an `npm` package needs an exact semver `version`, a `pypi` package an exact version, and an `oci` image an `@sha256:` digest in `identifier`. Empty, `latest`, ranges and tags are refused. Severity label: **Blocking**.

## Common causes

Copying `npx -y package` without a version; `^1.2.0` or `>=0.6`; an image tag such as `:latest` or `:1.0`.

## How to fix

Write the exact version you reviewed, or the image digest, and validate again.

```json
{ "registryType": "oci", "identifier": "ghcr.io/acme/kb-mcp@sha256:<64 hex>", "transport": { "type": "stdio" } }
```
