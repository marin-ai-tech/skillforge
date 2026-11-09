---
title: Provenance override
summary: Optionally sets one provenance source for every candidate in the run. Leave the default to keep each candidate's own provenance.
related: pages/import
---

## What it does

A list next to Select all with the default (keep candidate provenance) and the sources `human`, `reckon`, `agentspace`, `dreamteam` and `import`. A chosen source replaces the provenance source of every selected candidate when you click Import selected; the provenance ref detected for each candidate is kept.

## When to use

Keep the default when the scan already detects the origin, for example reckon for packages under `.reckon/skills` and human for most others. Pick a source when the whole import comes from one origin that the folder layout does not show, such as `import` for a bulk intake from a git repository or `agentspace` for packages from a team pipeline.

## Requires

Sign-in with contributor or higher and a completed Preview: the list appears only after Preview and applies to the next run.
