---
title: Lifecycle transition buttons
summary: Opens the transition dialog that moves an artifact to another lifecycle status. Use it from the artifact page or the lifecycle board whenever a status change is due.
related: getting-started/lifecycle
---

## What it does

Opens the shared transition dialog for a target status such as active, aging, zombie, retired, or candidate. On confirm, the server updates status, writes an audit transition event, and may refresh validated_at when revalidating.

## When to use

Use from the artifact lifecycle panel or the lifecycle board whenever a reviewer needs to change governance status.

## Requires

Reviewer or admin role. Reason required for retired and zombie targets.
