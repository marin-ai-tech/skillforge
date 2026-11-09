---
title: My agents
summary: My agents lists your agent snapshots and compares their items with the registry. Use it to add a folder, open a snapshot or delete one you no longer need.
section: ui-workspace
learn:
  - How to add an agent folder through the browser
  - What each agent row and its summary chips show
  - When to use the CLI scan instead of the browser
  - What deleting a snapshot keeps in the registry
related: pages/me-agent, pages/admin-agents, getting-started/agents, actions/agents/agent-add, actions/agents/agent-delete, actions/agents/menu-agents
---

## What this page is for

The My agents page (`/me/agents`) is your cabinet inventory of named agent snapshots. Each snapshot captures skills, commands, agents, and hooks discovered in a local folder (or a server path the admin registered for you). SkillForge compares every item to the live registry so you can see what is only on your machine, what matches a published version, what is outdated, and what changed locally. Use this page to add a folder through the browser, open a snapshot for publish or install hints, or delete a snapshot you no longer need. Signed-in users of any role can keep their own agents; publishing still requires contributor or higher on the detail page.

## What you see

- An `agents-list` of `agent-row` entries with the agent name (link to `/me/agents/<name>`), `agent-kind` text (`upload` or `server`), runtime, item count, summary chips (`agent-summary-<status>`), and the last scan time.
- An Add agent button (`agent-add`) that opens `agent-add-dialog` with kebab-case `agent-name`, `agent-runtime` select, and `agent-folder` using `webkitdirectory`. The runtime select lists every runtime of the server runtime table (`GET /api/v1/runtimes`, see [Agent support](getting-started/agent-support); Claude Code is the default), or Generic for folders that follow no client layout. If the table cannot be loaded, Generic and the current choice stay available.
- Empty state `agents-empty` with the CLI hint `skillforge agent scan .claude --name <name>` when you have no agents yet.
- Per-row Delete (`agent-delete`) with a confirm dialog, plus `agent-error` banners for failed uploads or deletes.

## Common tasks

1. Sign in and open Agents from the user menu (`menu-agents`) or go to `/me/agents`.
2. Click Add agent, enter a kebab-case name, optionally pick a runtime, choose a local folder, and submit (`agent-add-submit`). On success the app navigates to `/me/agents/<name>`.
3. Open a row to inspect item statuses, publish local-only skills, or copy install commands.
4. Delete a snapshot you no longer need; catalog artifacts already published stay in the registry.
5. Prefer the CLI for `~/.claude` homes that the browser cannot read, using the empty-state command as a template. `skillforge agent scan --runtime <id> --name <name>` without a folder scans that runtime's project folder (`.codex`, `.cursor`, `.opencode`, `.qwen`, and so on).
6. Only files that make up artifacts leave your machine: skill folders, commands, agents, and hook bundles. Other files in the folder, such as `settings.local.json`, `auth.json`, or `.env`, are not sent. The CLI says how many it kept back (`not sent: N file(s) outside artifacts`).

## Permissions

Requires a signed-in user. Anonymous visitors are redirected to `/login?next=/me/agents`. Every role may create upload snapshots and delete their own agents. Server agents appear here when you are the owning admin. Publishing from a snapshot is enforced on the detail page and needs contributor or higher.