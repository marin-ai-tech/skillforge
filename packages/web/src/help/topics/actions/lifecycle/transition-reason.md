---
title: Transition reason
summary: Records why the status changes; the reason is stored on the audit event of the transition. It is required when retiring an artifact or marking it zombie.
related: pages/lifecycle
---

## What it does

Captures a free-text reason (1–500 characters when required) stored on the audit event for the transition.

## When to use

Fill it when retiring or marking zombie; optional otherwise for promote, age, or restore.

## Requires

Visible in the transition dialog for reviewer and admin.
