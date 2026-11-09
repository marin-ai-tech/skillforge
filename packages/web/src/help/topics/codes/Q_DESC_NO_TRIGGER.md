---
title: Q_DESC_NO_TRIGGER
summary: Advisory: the description never says when to use the artifact, so agents matching it against requests rarely select it; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types
---

## What it means

Advisory: the `description` never says *when* to use the artifact. Agents pick skills by matching the description against the user request, so a description without a trigger phrase is rarely selected. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Descriptions that only describe *what* the skill does (`Formats SQL queries`); trigger wording buried in the body instead of the frontmatter; non-standard phrasing the detector does not recognise.

## How to fix

Start or extend the description with one of the recognised trigger phrases: `Use when`, `Use for`, `Use if`, `Use this skill when`, `When the user`, `When asked`, `When working`, `Invoke when`, `Triggers on`.

```yaml
description: Use when the user asks to format or lint SQL queries before a code review.
```
