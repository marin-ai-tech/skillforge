---
title: Delete agent snapshot
summary: Removes one of your agent snapshots after confirmation; artifacts you already published stay in the catalog. Use it when a laptop or CI snapshot is obsolete.
related: pages/me-agents, getting-started/agents
---

## What it does

Removes the named agent snapshot from your account after a confirmation dialog. Registry artifacts already published stay in the catalog.

## When to use

Use this when a laptop or CI snapshot is obsolete and you no longer need comparison statuses for it.

## Requires

Owner of the snapshot (signed-in). Confirmation via `dialog-confirm` is required before the DELETE runs.