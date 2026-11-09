---
name: power-grid
status: candidate
description: buffered APC power grid migration for the station power subsystem
when_to_use: the brief mentions power, APC or grid buffering
proven_by_gate: node --test core/tests/power.test.mjs
learned_at: 2026-08-02T11:55:00.000Z
triggers: power, apc, grid, buffered
use_count: 2
---

# power-grid

Proven procedure distilled from a run that PASSED its objective gate (`node --test core/tests/power.test.mjs`). Follow the same shape.

**Steps that worked** (files touched, in order):
- `core/power/apc.ts` — introduce the buffered grid component
- `core/power/index.ts` — register it
