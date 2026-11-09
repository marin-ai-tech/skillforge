---
title: Q_TOOLS_UNBOUNDED
summary: Advisory: the artifact's tool list grants unrestricted shell access, so reviewers cannot tell what it actually needs; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types
---

## What it means

Advisory: `allowed-tools` (skill, command) or `tools` (agent) grants unrestricted shell access: `*`, `Bash`, `Bash(*)` or `Bash(:*)`. The artifact will work, but reviewers cannot tell what it actually needs. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Copying a permissive template; granting `Bash` to avoid listing individual commands; leaving `*` from local experiments.

## How to fix

List the specific commands the artifact runs. Narrow `Bash` to command patterns and keep the list short; it doubles as documentation for reviewers.

```yaml
# before
allowed-tools: Bash
# after
allowed-tools: Read, Grep, Bash(git status:*), Bash(git diff:*)
```
