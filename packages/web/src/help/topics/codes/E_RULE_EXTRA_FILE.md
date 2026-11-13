---
title: E_RULE_EXTRA_FILE
summary: Blocking error: a rule package holds more than one file.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: next to the rule's markdown file there are other files. A rule is the text an agent reads as instructions, so it is exactly one markdown file; scripts, examples and references belong to a skill, which the agent opens on demand. Severity label: **Blocking**.

## Common causes

Publishing a folder with notes or examples next to the rule.

## How to fix

Publish the rule file alone; keep supporting files in a skill.

```bash
skillforge publish rules/api-style.md --type rule
```
