---
title: Q_SETTINGS_BROAD_ALLOW
summary: Advisory: the profile's allow list uses a broad pattern that unlocks the shell or all tools for everyone who applies it; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types, getting-started/cli
---

## What it means

Advisory: `permissions.allow` includes a broad pattern (`*`, `Bash`, `Bash(*)`, or `Bash(:*)`) that effectively unlocks shell or all tools. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Shortcuts for demos; copying personal allow-all configs into a shared profile; misunderstanding that `Bash` alone is unrestricted.

## How to fix

Replace broad entries with specific tool names or matched Bash commands, and document why any remaining broad allow is required.

```json
{
  "permissions": {
    "allow": ["Read", "Grep", "Bash(git status:*)"]
  }
}
```
