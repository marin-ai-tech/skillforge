---
title: Save eval suite
summary: Saves the whole eval suite: its cases and optional gate. Use it after editing cases, holdout flags, or checks on the Evals tab.
related: getting-started/skill-evals, getting-started/eval-runs-runners, getting-started/eval-gate
---

## What it does

Writes the whole suite (cases and optional gate) with PUT. Surfaces suite_invalid detail and gate_needs_holdout.

## When to use

After editing trigger/task cases, holdout flags, or checks on the Evals tab.

## Requires

Owner, maintainer, reviewer, or admin on a skill. Reviewer+ to turn gate off.
