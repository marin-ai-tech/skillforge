---
title: Agent snapshot
summary: The agent snapshot page compares one agent's items with the registry. Use it to publish local-only or modified items, copy install commands and review duplicate roots.
section: ui-workspace
learn:
  - What the local_only, in_sync, outdated, modified and registry_only statuses mean
  - How to publish an item from the snapshot
  - How to refresh upload and server agents
  - How to handle duplicate roots in a snapshot
related: pages/me-agents, getting-started/agents, getting-started/duplicates, actions/agents/agent-item-publish, actions/agents/agent-item-install, actions/agents/agent-rescan, actions/agents/agent-registry-all
---

## What this page is for

The agent detail page (`/me/agents/:name`) shows one snapshot compared against the registry. Summary chips count `local_only`, `in_sync`, `outdated`, `modified`, and `registry_only` items. Filters narrow the table client-side. From here contributors publish a local-only or modified item into the catalog with provenance `agent:<name>`, and anyone can copy CLI install commands for outdated or registry-only artifacts. Upload agents refresh via CLI; server agents offer an in-page Rescan button that calls the owner scan API.

## What you see

- Browser tab title made of the agent name followed by · Agents · SkillForge, and summary chips `agent-summary-<status>`.
- Filters `agent-filter-all` and `agent-filter-<status>`, plus `agent-registry-all` which sets `?registry_status=all`.
- Table `agent-items` with rows `agent-item` carrying `data-status` and `data-key="<type>/<name>"`, status text, local version or short digest, registry version, and `agent-item-changed` for modified files.
- Hint `agent-item-translated` ("installed with translation") on items that were installed from the registry in a client format (for example Codex TOML or OpenCode markdown). The files were converted for the client on install, so SkillForge compares them through the lock file: an untouched translated install shows `in_sync` or `outdated` instead of `modified`. Hover the hint for the explanation. Items without the flag, including those in older snapshots, show no hint.
- Actions `agent-item-publish` (contributor+) and `agent-item-install` (outdated / registry_only) with CopyButton.
- Section `agent-mcp`: the MCP servers of this agent's configs, sent with `skillforge agent scan --mcp`. Before the first such scan it shows `agent-mcp-hint` with the command; after it, the time of the scan and rows `agent-mcp-server` with name, scope, source file template, transport, package and version or remote address, and notes: not pinned, literal secret with the names of the variables or headers, disabled. Values never reach the registry, so the page cannot show them.
- Refresh hint `agent-refresh-hint`: CLI scan text for upload agents, or `agent-rescan` for server agents.
- Banners `agent-notice` and `agent-error`; `agent-missing` when the name is not yours or does not exist.
- When the snapshot reports colliding roots, section `agent-duplicates` lists groups with `data-class` replica, divergent, or stale_backup, each showing the recommended `agent-duplicate-keep` root.

## Common tasks

1. Open an agent from the list or a deep link `/me/agents/<name>`.
2. Filter to `local_only`, publish with confirmation, and confirm the notice shows `type/name@version` while the row becomes `in_sync`.
3. Toggle registry-all and filter `registry_only` to find catalog entries missing from the snapshot, then copy `skillforge install <type>/<name>`.
4. For server agents, click Rescan after files change on the host; for upload agents, re-run the CLI scan command shown in the hint.
5. Fix what `agent-mcp` marks on your machine: replace a literal secret with a reference such as `${VAR}`, pin the package to an exact version, then scan again with `--mcp`.
6. Review `agent-duplicates` when present: keep the recommended root, delete replicas or merge divergent copies, and remove stale backups after confirming the current copy.
6. If you see `agent-missing`, return to `/me/agents` - snapshots are owner-scoped.

## Permissions

Signed-in owner only for GET/PUT/DELETE of the snapshot. Other users receive a missing state (404). Publish requires contributor or higher; viewers can own a snapshot but will not see Publish. Owner rescan is allowed only when `kind` is `server`; upload agents return `409 not_server_agent` from the API.