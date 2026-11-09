---
title: Transfer ownership
summary: Hands the artifact to another owner, with a required reason. Use it when responsibility moves to another author or an admin cleans up orphaned artifacts.
related: getting-started/ownership, actions/artifact/add-maintainer
---

## What it does

Opens a confirmation dialog, then calls `POST /api/v1/artifacts/:type/:name/owner` with the new owner username and a required reason. On success the card shows the new owner and the former owner loses the ownership panel (unless they are admin).

## When to use

Hand an artifact to another author when responsibility moves, or when an admin cleans up orphans after auth-mode changes. Do not use reviewer publish-override as a substitute for a real transfer.

## Requires

Current owner or admin; the recipient must be an enabled contributor or higher and not already the owner. MCP tokens are not allowed.
