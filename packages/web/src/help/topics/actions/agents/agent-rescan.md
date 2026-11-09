---
title: Rescan server agent
summary: Rescans the registered path of your server agent and refreshes its item statuses. Use it after files change on the host, instead of uploading again from the CLI.
related: pages/me-agent, pages/admin-agents, getting-started/agents
---

## What it does

Calls `POST /api/v1/me/agents/:name/scan` for a server agent, re-validates the path with realpath against roots, refreshes stored items, and shows `agent-notice` on success.

## When to use

Use this after files change on the host under the registered server path and you want statuses updated without CLI upload.

## Requires

Owner of a `kind=server` agent. Upload agents cannot use this control (`409 not_server_agent`). Roots must be enabled.