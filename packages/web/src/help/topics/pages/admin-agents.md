---
title: Agents administration
summary: Agents administration lets admins register server agents from directories on the SkillForge host. Use it to scan, rescan and delete server agent snapshots across owners.
section: ui-admin
learn:
  - How to register a server agent under the configured roots
  - What happens when a path is outside the roots
  - How to rescan and delete agent snapshots
  - Who may use the page and its APIs
related: pages/me-agents, getting-started/agents, actions/agents/server-agent-submit, actions/agents/admin-agent-scan, actions/agents/admin-agent-delete, actions/agents/menu-admin-agents
---

## What this page is for

Agents administration (`/admin/agents`) lets administrators register **server** agents whose directories live on the SkillForge host inside `SKILLFORGE_AGENT_ROOTS`. Creating an agent scans the path (skipping `node_modules` and `.git`), stores the snapshot under the admin owner, and exposes it in that admin's My agents list with `kind = server`. Admins can rescan, inspect owners across all agents, and delete any snapshot. Paths are validated with lexical prefix checks and `fs.realpathSync` so junctions that escape the roots are rejected with `path_outside_roots`.

## What you see

- Title Agents administration · SkillForge and help topic `pages/admin-agents`.
- `agent-roots` listing absolute roots when enabled, or `agent-roots-disabled` explaining how to set `SKILLFORGE_AGENT_ROOTS`.
- Form `server-agent-form` with `server-agent-name`, `server-agent-path`, `server-agent-runtime`, and `server-agent-submit`. The runtime select offers every runtime of the server runtime table (`GET /api/v1/runtimes`, see [Agent support](getting-started/agent-support); Claude Code is the default) or Generic; Generic stays available even when the table cannot be loaded.
- Table `admin-agents-table` / `admin-agent-row` showing name, owner, kind, runtime, item count, and scanned time. The first link on your own rows goes to `/me/agents/<name>`.
- Row actions `admin-agent-scan` (server only) and `admin-agent-delete` with confirmation.
- Shared banners `admin-error` (includes API error codes) and `admin-notice`. Non-admins see `admin-forbidden`.

## Common tasks

1. Sign in as admin and open Agents admin from the user menu (`menu-admin-agents`).
2. Confirm roots are listed; if disabled, configure the environment variable and restart.
3. Enter a kebab-case name and an absolute path under a root, then submit. On success a notice appears and a row is added.
4. Intentionally try a path outside roots to verify `admin-error` shows `path_outside_roots`.
5. Use Scan after files change on disk, open your own agent via the name link to use owner Rescan, then Delete when finished.

## Permissions

Requires role admin. Other signed-in roles see `admin-forbidden`. Anonymous users are redirected to login. Create/scan APIs also return `403 agent_roots_disabled` when no roots are configured. Owner-scoped My agents APIs remain available to the admin who owns the server agent.