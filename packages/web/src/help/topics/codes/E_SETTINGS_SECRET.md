---
title: E_SETTINGS_SECRET
summary: Blocking error: the settings profile holds a literal secret in env, which everyone who can read the registry would see, so the version cannot be published.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: `env` contains a literal secret. Keys are matched case-insensitively when they include `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `APIKEY`, or `PRIVATE_KEY`, and the value is non-empty and not an `${VAR}` reference. Severity label: **Blocking**.

> [!CAUTION]
> Profiles are published to everyone who can read the registry, so literals must never ship inside the bundle.

## Common causes

Copying a personal `.claude/settings.json` that already holds tokens; pasting a CI secret into the profile; forgetting to wrap the value as `${GITHUB_TOKEN}`.

## How to fix

Replace literals with environment references such as `"${GITHUB_TOKEN}"` and keep real secrets outside the published artifact. Re-validate; the path in the issue points at `settings.json`.

```json
{
  "env": {
    "GITHUB_TOKEN": "${GITHUB_TOKEN}"
  }
}
```
