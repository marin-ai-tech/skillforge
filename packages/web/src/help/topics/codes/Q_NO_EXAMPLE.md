---
title: Q_NO_EXAMPLE
summary: Advisory: the main file has no code block or example section, and agents follow concrete samples far more reliably than prose; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types
---

## What it means

Advisory: the main file has neither a fenced code block nor a heading containing `example`. Agents follow concrete input/output samples far more reliably than prose alone. Applies to skills and commands. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Skills written as a bulleted policy; commands that only describe the intent; examples kept in a reference file without any hint in the main body.

## How to fix

Add an `## Example` section or a fenced block with a representative request and the expected output. One short example is enough to clear the check.

```markdown
## Example

Request: "format this query"

```sql
SELECT id, name FROM users WHERE active = 1;
```
```
