---
name: nutrition-migration
status: candidate
description: migrate the nutrition and hunger subsystem to the buffered component model
when_to_use: the brief mentions nutrition, hunger or buffered components
proven_by_gate: node --test core/tests/nutrition.test.mjs
learned_at: 2026-08-02T11:55:00.000Z
triggers: nutrition, hunger, migrate, subsystem, buffered
use_count: 3
---

# nutrition-migration

Proven procedure distilled from a run that PASSED its objective gate (`node --test core/tests/nutrition.test.mjs`). Follow the same shape.

**Verify with:** `node --test core/tests/nutrition.test.mjs` — if this procedure applies here, that check should pass once you have followed it.

**Original task**
Migrate the nutrition and hunger subsystem to the buffered component model.

**Steps that worked** (files touched, in order):
- `core/nutrition/hunger.ts` — replace direct field writes with buffered setters
- `core/nutrition/index.ts` — register the buffered component
