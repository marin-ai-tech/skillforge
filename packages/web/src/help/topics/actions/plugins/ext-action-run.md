---
title: Run review
summary: Sends the current artifact version to the review-assistant plugin, where several model reviewers audit it and a judge merges their findings. Use it for an independent, evidence-backed audit.
related: getting-started/review-assistant, actions/plugins/ext-action-decision
---

## What it does

Posts the current artifact version to the review-assistant plugin queue. Several external reviewers (different models) audit the prompt against a checklist, the judge merges their findings with an agreement measure, and the run is recorded as evidence on the version.

## When to use

Use it when an artifact has reached the review queue and you want an independent, evidence-backed audit before deciding each finding. Only one run proceeds at a time per version; a duplicate run for the same version is rejected.

## Requires

Role reviewer or admin. Viewers see the run summary and findings but no action buttons.
