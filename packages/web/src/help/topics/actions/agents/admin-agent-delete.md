---
title: Admin delete agent
summary: Deletes any user's agent snapshot from the admin table after confirmation. Use it to clean up stale snapshots across the instance; published registry artifacts are not removed.
related: pages/admin-agents, getting-started/agents
---

## What it does

Deletes any agent snapshot by id after confirmation, including upload agents owned by other users.

## When to use

Use this for cleanup across the instance when an owner left a stale snapshot or a server path was retired.

## Requires

Admin role and confirmation via `dialog-confirm`. Does not remove published registry artifacts.