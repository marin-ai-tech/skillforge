---
title: Admin rescan agent
summary: Rescans a server agent from the admin table, re-checking its path against the allowed roots. Use it when host files changed and you do not want to open the owner's agent page.
related: pages/admin-agents, getting-started/agents
---

## What it does

Runs `POST /api/v1/admin/agents/:id/scan` for a server agent, re-checking roots with realpath and refreshing the snapshot items and notice banner.

## When to use

Use this from the admin table when host files changed and you prefer not to open the owner detail page.

## Requires

Admin role. Only shown for `kind=server` rows. Junction escapes still fail with `path_outside_roots`.