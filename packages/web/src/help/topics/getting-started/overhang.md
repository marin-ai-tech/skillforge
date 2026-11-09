---
title: Product overhang
summary: How SkillForge flags artifacts that ablation evidence shows the model no longer needs, and what to do with such candidates.
section: evidence
learn:
  - What product overhang means
  - Who can read the overhang endpoints
  - How candidates are selected
  - What to do with an overhang candidate
related: getting-started/lifecycle-by-data, getting-started/skill-evals, getting-started/ablation-report
---

**Overhang** is the flip side of lifecycle automation: an artifact whose own
data suggests the catalog has outgrown it. The canonical signal is a
**completed ablation report** showing no measurable uplift — if a skill
performs the same without its files as with them, the model already covers
the behavior and the artifact is mostly a distribution cost.

## Endpoints

`GET /api/v1/lifecycle/overhang` lists fleet-wide candidates;
`GET /api/v1/artifacts/:type/:name/overhang` computes the per-artifact
report with the evidence behind the verdict. Both endpoints are restricted
to **administrators** — the report mixes lifecycle internals and eval
evidence — and **MCP tokens are banned** (`403 mcp_token_forbidden`), since
machine tokens must not read operator diagnostics.

## How candidates are selected

Candidate selection is driven by **ablation evidence**, not by freshness: an
artifact that merely has an old `updated_at` but no eval signal is **not**
flagged. The report cites the specific evidence (for example
`no_uplift`: the latest ablation shows no uplift),
so the reviewer sees why the item surfaced instead of guessing from dates.

## What to do with a candidate

> [!NOTE]
> Overhang is a report, not an automatic action — nothing is retired or deleted by it.

Typical follow-ups: run a fresh ablation to confirm, check
install/usage evidence on the artifact card, then either keep (document the
reason), mark an active artifact `aging` with Mark aging in the Lifecycle
panel of the artifact page, or plan a graceful retire with a migration note
for dependents. There is no move back to candidate: that status is reached
only by restoring a retired artifact.