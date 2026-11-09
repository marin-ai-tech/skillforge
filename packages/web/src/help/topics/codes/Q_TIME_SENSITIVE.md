---
title: Q_TIME_SENSITIVE
summary: Advisory: the text uses wording that goes stale, such as dates or the latest version, so instructions quietly become wrong; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types
---

## What it means

Advisory: the text contains wording that goes stale, such as `as of 2025`, `after March 2024`, `the latest version`, `this year` or `currently supported`. The report shows the file and line of each hit. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Notes copied from release announcements; model or tool version advice (`use the newest model`); dates from the moment the skill was written.

## How to fix

State facts that stay true, or pin them to explicit versions and let the agent check the current state at run time. Remove relative time words.

```markdown
# before
Use the latest version of the CLI (as of 2025).
# after
Requires CLI >= 3.2; run `tool --version` to check.
```
