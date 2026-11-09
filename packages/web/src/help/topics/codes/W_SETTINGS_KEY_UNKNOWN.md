---
title: W_SETTINGS_KEY_UNKNOWN
summary: Warning: settings.json has a top-level key SkillForge does not recognize; publication still succeeds, but confirm the key is intentional and supported by Claude Code.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Warning: `settings.json` has a top-level key SkillForge does not recognize yet. Severity label: **Warning**. Warnings do not block publication, but reviewers should confirm the key is intentional and supported by the target Claude Code version. Unknown keys still merge on `settings apply`.

## Common causes

Typos (`permisions`); brand-new Claude Code settings keys not yet listed in the SkillForge allow-list; experimental flags copied from a beta build.

## How to fix

Rename the key to a documented Claude Code setting, or confirm with the platform team that the key is required and file a follow-up to extend the known-key list. Re-run validation to refresh warnings.

```json
{
  "permissions": { "allow": ["Read"] },
  "model": "opus"
}
```
