---
title: Q_SETTINGS_API_KEY_HELPER
summary: Advisory: the settings profile sets apiKeyHelper, a command run to obtain an API key, which every consumer of the profile should review; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types, getting-started/cli
---

## What it means

Advisory: the profile sets `apiKeyHelper`, a command Claude Code runs to obtain an API key. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Enterprise key brokers; shared helper scripts checked into the profile; copying a laptop config that prints keys from a password manager.

## How to fix

Prefer documenting the helper outside the published profile, or ensure the command is reviewed and does not embed secrets. Reviewers should confirm the helper path is acceptable for all consumers of the profile.

```json
{
  "apiKeyHelper": "/usr/local/bin/print-org-key.sh"
}
```
