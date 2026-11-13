---
title: E_RULE_PATHS_INVALID
summary: Blocking error: `paths` of a rule is not a list of file patterns.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: `paths` in the frontmatter of a rule is a string, an empty list or holds an empty pattern. Severity label: **Blocking**.

## Common causes

Writing `paths: src/**` as one string; leaving `paths: []` for a rule meant to apply always.

## How to fix

Write a list of patterns, or leave `paths` out for a rule that always applies.

```yaml
---
name: api-style
description: Style of the API handlers.
paths:
  - "src/api/**/*.ts"
---
```
