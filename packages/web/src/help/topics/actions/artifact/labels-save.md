---
title: Save labels
summary: Replaces the artifact's registry labels without creating a new version. Use it to tag artifacts for catalog filters, CLI listing, and MCP tag consent.
related: getting-started/labels, pages/artifact
---

## What it does

Replaces the artifact registry labels list. Does not create a new version. Invalid kebab labels are rejected by the API.

## When to use

Tag artifacts for catalog filters, CLI list --label, and MCP tag consent without republishing a version.

## Requires

Owner, maintainer, or reviewer+/admin. MCP tokens are rejected.
