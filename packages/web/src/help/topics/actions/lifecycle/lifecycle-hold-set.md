---
title: Set lifecycle hold
summary: Sets a hold that pauses automatic lifecycle transitions for an artifact until a given date. Use it during release freezes or while investigating a false zombie signal.
related: getting-started/lifecycle-hold-sweep, actions/lifecycle/cleanup-retire
---

## What it does

Creates or replaces a hold that skips automatic lifecycle transitions until the given timestamp.

## When to use

Use during release freezes or while investigating a false zombie signal. Clear the hold when finished.

## Requires

Reviewer or admin, not the artifact owner. Until must be a future ISO date within 365 days; reason at least five characters.
