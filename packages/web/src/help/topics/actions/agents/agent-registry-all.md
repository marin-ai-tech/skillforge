---
title: Show all registry statuses
summary: Includes non-retired registry artifacts of every status, such as candidates, in the registry-only list of an agent. Use it when hunting for catalog entries the snapshot never received.
related: pages/me-agent, getting-started/lifecycle
---

## What it does

Toggles `?registry_status=all` so `registry_only` includes non-retired catalog entries beyond the default active set (for example candidates).

## When to use

Use this when hunting for registry artifacts that never landed in the snapshot, including candidates still in review.

## Requires

Signed-in owner viewing the agent detail page. Filtering remains client-side after the refetch.