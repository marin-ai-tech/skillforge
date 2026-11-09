---
title: E_PLUGIN_MANIFEST_MISSING
summary: Blocking error: the bundle has no .claude-plugin/plugin.json at its root, so it is not a valid Claude Code plugin and the version cannot be published.
related: pages/publish, actions/publish/issue-help, getting-started/artifact-types
---

## What it means

Blocking error: a Claude Code plugin bundle must include `.claude-plugin/plugin.json` at the bundle root (after stripping a shared top folder). Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse.

## Common causes

Upload without the manifest folder; wrong type selected; paths nested under an unexpected root.

## How to fix

Add `.claude-plugin/plugin.json` with kebab-case `name` and a `description`, then re-validate as type `plugin`. Re-run validation on the Publish page and confirm the issue disappears from the issue list.

```
.claude-plugin/plugin.json
skills/<name>/SKILL.md
commands/<name>.md
agents/<name>.md
hooks/hooks.json
.mcp.json
```
