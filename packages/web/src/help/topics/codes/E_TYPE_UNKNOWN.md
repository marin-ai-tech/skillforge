---
title: E_TYPE_UNKNOWN
summary: Blocking error: the artifact type sent with the publish request is not a known type, so validation stops before any other check and the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: the publish type is not one of skill, command, agent, hook, plugin, settings, or mcp-server. parseArtifact rejects unknown types before deeper checks. Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Typo in the type field; stale client; API called with a custom type; wrong Publish dropdown value. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), hook (`hooks/hooks.json`), plugin (`.claude-plugin/plugin.json`), settings (`settings/<name>/settings.json`), and mcp-server (`mcp/<name>/MCP.md`).

## How to fix

Set type to skill, command, agent, hook, plugin, settings, or mcp-server only. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
curl -X POST /api/v1/artifacts -H "Authorization: Bearer sf_demo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" -F type=skill
```
