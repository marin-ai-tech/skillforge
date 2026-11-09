---
title: Q_DESC_SHORT
summary: Advisory: the description has fewer than 10 words, leaving agents almost nothing to choose by; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types
---

## What it means

Advisory: the `description` has fewer than 10 words, so an agent has almost nothing to decide from when choosing whether to load this artifact. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

A one-line placeholder such as `Deploy helper`; a description copied from the folder name; frontmatter written before the body was finished.

## How to fix

Expand the description to a full sentence that names the task, the trigger and the boundary. Re-run validation on the Publish page; the check disappears when the description reaches 10 words.

```yaml
description: Use when the user asks to deploy a service to staging via the release CLI; not for production rollouts.
```
