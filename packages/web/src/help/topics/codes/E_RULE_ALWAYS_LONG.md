---
title: E_RULE_ALWAYS_LONG
summary: Blocking error: a rule without paths is too long for the context of every agent turn.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: a rule without `paths` is loaded on every turn of the agent, and its body is over 1500 tokens. Severity label: **Blocking**.

## Common causes

A whole style guide put into one always-on rule.

## How to fix

Shorten the rule to what the agent must always follow, split it, or add `paths` so that it loads only for matching files.

```yaml
---
name: api-style
description: Style of the API handlers.
paths: ["src/api/**/*.ts"]
---
```
