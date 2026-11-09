---
title: E_SETTINGS_JSON_MISSING
summary: Blocking error: the settings profile has no settings.json next to SETTINGS.md, so there is nothing to apply and the version cannot be published.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: a settings profile must include `settings.json` next to `SETTINGS.md`. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse. Without the JSON fragment there is nothing for `skillforge settings apply` to merge.

## Common causes

Uploading only `SETTINGS.md`; nesting `settings.json` under an unexpected folder so it is dropped; selecting type `settings` for a skill or plugin bundle.

## How to fix

Add a JSON object file named `settings.json` beside `SETTINGS.md` in the profile folder, then re-validate as type `settings`. Confirm the issue disappears from the Publish issue list.

```
settings/<name>/SETTINGS.md
settings/<name>/settings.json
```
