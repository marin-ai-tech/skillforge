---
title: Ablation report
summary: How an ablation record measures whether a skill helped on a fixed task set, and how its uplift feeds metrics and the lifecycle.
section: evidence
learn:
  - How uplift is calculated
  - How to submit an ablation report in the UI or CLI
  - When a zero or negative uplift can make an artifact zombie
related: getting-started/lifecycle-by-data, getting-started/evidence-and-usage, actions/artifact/evidence-add
---

An ablation evidence record measures whether the skill helped on a fixed task set: how many tasks were attempted, how many passed with the skill, and how many passed without it. SkillForge stores those counts plus optional runner and computes uplift = (passed_with - passed_without) / tasks rounded to three decimals. The latest ablation for a version appears in version detail, and the latest across the artifact appears in metrics and lifecycle signals.

> [!NOTE]
> Ablation never advances validated_at; use gate evidence when you need validation timestamps.

## How to submit

Owners, maintainers, and reviewers add evidence with kind ablation and a safe http(s) or registry path URL. Provide tasks from 1 to 1000 and passed counts from 0 to tasks inclusive. Optional runner labels the CI system (max 64 characters). The web form shows evidence-tasks, evidence-passed-with, and evidence-passed-without when ablation is selected and rejects out-of-range values client-side. CLI example: skillforge evidence add skill/x@0.1.0 --kind ablation --url https://ci.example/1 --tasks 20 --passed-with 16 --passed-without 10 --runner ci. For non-ablation kinds, --tasks and --passed-* flags are rejected. Server error ablation_invalid is humanized in the evidence tab.

## Minimum tasks and zombie rule

Policy uses SKILLFORGE_ABLATION_MIN_TASKS (default 10). When the latest ablation has enough tasks and uplift is at or below zero, a sweep may move the artifact to zombie under rule no_ablation_uplift. Positive uplift is a healthy signal shown on the lifecycle panel signal-ablation and as uplift text in the evidence list. Authors are recorded like other evidence; false reports are mitigated because zombie is reversible by reviewers and never destroys content.
