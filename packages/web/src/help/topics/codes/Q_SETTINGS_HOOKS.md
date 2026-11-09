---
title: Q_SETTINGS_HOOKS
summary: Advisory: the settings profile embeds hooks, which get richer risk analysis as a dedicated hook artifact; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types, getting-started/hook-risks
---

## What it means

Advisory: the profile embeds a `hooks` object. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in. Hook risk analysis is richer on a dedicated `hook` artifact.

## Common causes

Shipping Stop/PreToolUse hooks inside a settings baseline; migrating from a personal settings file that already had hooks.

## How to fix

Move hooks to a `hook` (or `plugin`) artifact so SkillForge can run hook intelligence checks, and keep the settings profile focused on permissions, model, and env.

```
hooks/hooks.json   # prefer a hook artifact
settings/<name>/settings.json  # keep permissions/env/model here
```
