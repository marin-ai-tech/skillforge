---
title: Inventory across the organisation
summary: The inventory sums up the agent snapshots of everyone in the organisation, showing own and imported artifacts, copies that differ from the registry and copies the registry has never seen.
section: ui-admin
learn:
  - Where the inventory gets its data
  - What the copy states mean
  - How to read origin and variants
  - What the inventory never shows
related: pages/me-agents, pages/admin-agents, pages/admin-report
---

## What this page is for

The inventory answers "what actually stands on our machines". People and the CLI send agent snapshots (`PUT /api/v1/me/agents/<name>`, `skillforge agent scan`); each person sees their own on the agents page. This page sums up all of them for an admin: which artifacts are installed, where copies drifted from the registry and what circulates without ever being published. Use it to find skills worth bringing into the registry and copies that need an update.

## What you see

- Totals (`inventory-totals`): people, agents, copies and copies by state — in sync, outdated (matches an older version), modified (matches no version) and not in the registry.
- A table of artifacts (`inventory-artifacts`): origin — own (published here), imported (came through import, a mirror or a starter pack) or not in the registry — with copies, people, variants (different contents) and copies by state. Artifacts that need attention come first.
- A table by person (`inventory-people`): agents, copies, copies outside the registry and the time of the last snapshot.

## Common tasks

1. Open the inventory from the user menu (`menu-admin-inventory`) or go to `/admin/inventory`.
2. Look at the artifacts not in the registry with more than one copy: one variant means people share the same file, a good candidate to publish.
3. For modified copies of imported artifacts, check whether people changed a third-party skill locally.
4. Ask people with old snapshots to send a fresh one.
5. Pull the same data as JSON with `GET /api/v1/admin/inventory`.

> [!NOTE]
> The inventory shows names and counts only: no folders, file names or file contents leave the snapshots.

## MCP servers

When people scan with `skillforge agent scan --mcp`, the snapshot also carries the MCP servers configured in their agent (Claude Code, Codex, Cursor and OpenCode). The section `inventory-mcp` shows them below the people table, and the same data is in the JSON of `GET /api/v1/admin/inventory`, field `mcp`. Without any scan with `--mcp` the section shows `inventory-mcp-empty` with the command.

- Totals `inventory-mcp-totals` (`mcp.totals`): agents scanned with `--mcp`, people, distinct servers, installs, unpinned installs (a package run without an exact version), installs with a literal secret, remote installs.
- Rows `inventory-mcp-server` (`mcp.servers`): one entry per package (`package:npx:tickets-mcp`), remote origin (`origin:https://mcp.example.com`) or, for local scripts, name. Each entry lists names, people, pinned versions and how many installs are unpinned, carry a literal secret or are disabled. Entries with literal secrets come first, then unpinned ones. The column `inventory-mcp-registry` names the registry `mcp-server` that declares the same package or remote origin (with its status), or says it is not in the registry: a shadow server.

> [!NOTE]
> No values reach the registry: not variables, headers, arguments, URL paths nor project paths. A literal secret is a flag and the names of the variables; the person fixes it on their machine by switching to a reference such as `${VAR}`.

## Permissions

Requires role admin, because the inventory shows what each person has installed. Other roles get 403 from the API and see the forbidden state here; anonymous visitors are sent to sign in.
