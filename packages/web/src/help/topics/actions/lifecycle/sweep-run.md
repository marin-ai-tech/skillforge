---
title: Run lifecycle sweep
summary: Applies the data lifecycle policy for real: aging, zombie, and revive transitions up to the per-sweep limit. Use it after a dry run on the admin lifecycle page shows the intended changes.
related: pages/admin-lifecycle, getting-started/lifecycle-hold-sweep
---

## What it does

Applies the data lifecycle policy for real: aging, zombie, and revive transitions up to max_per_sweep.

## When to use

After a successful dry-run on /admin/lifecycle when thresholds are intentional.

## Requires

Admin role and ConfirmDialog confirmation.

> [!TIP]
> Prefer dry-run first; automation never retires or purges.
