---
title: Catalog
summary: Catalog is the searchable, filterable list of every artifact in the registry. Use it to discover artifacts, build review queues by status and share filtered views by URL.
section: ui-catalog
learn:
  - How to filter by type, status, tag, agent and search text
  - How filters persist in the URL for shareable links
  - How to page through results and open an artifact
  - Who may read the catalog
related: pages/home, actions/catalog/browse-search, getting-started/lifecycle
---

## What this page is for

Catalog at `/artifacts` is the searchable, filterable list of every artifact identity in the store. Filters persist in the URL (`type`, `q`, `tag`, `status`, `team`, `owner`, `label`, `agent`, `page`) so reloads and shared links restore the same view. Use it to discover skills, commands, agents, hooks, plugins, settings profiles and MCP servers, to assemble review queues by status, and to open detail pages. Search debounces within 400 ms without requiring Enter. Pagination uses 24 cards per page. This page is the hub behind Home counts, tag clicks, and header search.

## What you see

- Tabs `browse-tab-all` and one `browse-tab-<type>` per artifact type from the registry, with `aria-selected` on the active tab. Each count uses every other filter on the page, so the All tab always matches `browse-total`.
- Team, owner and label filters `filter-team`, `filter-owner`, `filter-label` bound to `team`, `owner` and `label`.
- Search field `browse-search` bound to `q`; status filter `browse-status` for candidate, active, aging, zombie, retired.
- Active tag chip `browse-tag` with a clear control when `tag` is set.
- Agent filter `filter-agent` (All agents or one runtime) bound to `agent`: it keeps artifacts whose type installs into that agent and whose author either listed no agents or listed this one ([details](getting-started/agent-support)).
- Each card shows the agents the author listed, with minimum versions such as Claude Code ≥ 2.1, or "Agents: N" when the author listed none. Cards may also carry `artifact-replaced` (replaced by a successor), `artifact-security` (the security scan warned or failed), `artifact-context-high` (costly context) and `artifact-badge` (a badge set by an enabled server plugin, such as the outcome of a review).
- Results list `browse-results`, total line `browse-total`, pagination `browse-pagination` with `page-prev` / `page-next`.
- Empty state for zero hits; error state with retry on API failure; the browser tab title is Catalog · SkillForge.

## Common tasks

1. Open Catalog from nav or by clicking a Home type count.
2. Select a type tab and confirm `type=` appears in the URL.
3. Type into search (for example `pdf`) and wait for filtered cards and `q=` in the URL.
4. Filter status to `candidate` for review or `zombie` / `aging` for delete-today triage.
5. Click a tag on a card; clear the chip when finished.
6. Pick your agent in the Agent filter to see only what installs into it, and check `agent=` in the URL.
7. Page through results or open a card to `/artifacts/<type>/<name>`.

## Permissions

Follows API read policy: anonymous when public read is enabled; otherwise viewer and above. Publishing is not done here—use Publish as contributor+. Status transitions need reviewer+. Admin user management is separate.
