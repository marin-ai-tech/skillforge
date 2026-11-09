---
title: E_SETTINGS_RUNTIME
summary: Blocking error: the runtime or scope declared in SETTINGS.md is not one of the supported values, so the version cannot be published.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: `SETTINGS.md` frontmatter `runtime` must be `claude-code` (default) and `scope` must be `user`, `project`, or `local` (default `project`). Any other value is rejected. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse.

## Common causes

Experimenting with `runtime: cursor` or `vim`; typos such as `scopes: project`; inventing a new runtime before runtime-translation exists.

## How to fix

Set `runtime: claude-code` (or omit it) and `scope` to one of `user` | `project` | `local`, then re-validate.

```yaml
---
name: team-baseline
description: Company baseline for Claude Code. Use when onboarding a developer machine.
runtime: claude-code
scope: project
---
```
