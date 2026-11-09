---
title: Metrics board
summary: The metrics board compares visible artifacts by Transfer Rate, Ablation Score, sessions and Token Efficiency. Use it to spot strong or weak artifacts and export the filtered set.
section: ui-review
learn:
  - What the summary cards and table columns show
  - How to filter, sort and page the board
  - How to export rows as CSV or JSON
  - Which artifacts the board includes and who may export
related: getting-started/reading-metrics, pages/artifact, pages/catalog, getting-started/session-metrics
---

## What this page is for

Route `/metrics` is the registry-wide metrics board for SkillForge. It summarizes visible artifacts with Transfer Rate, Ablation Score, sessions, and Token Efficiency (file-size estimate), so reviewers and contributors can spot strong or weak skills without opening every card. Filters, sort, and pagination stay in the URL query so links remain shareable. Use this page when Catalog search is not enough and you need comparable numeric signals across the board. Export (signed-in only) downloads the same filtered set as CSV or JSON for spreadsheets.

> [!NOTE]
> Numbers are signals, not proofs of quality.

## What you see

- Summary cards `metrics-total-artifacts`, `metrics-total-transfer`, `metrics-total-ablation`, and `metrics-total-sessions` for the filtered visible set.
- Filters `metrics-filter-type`, `metrics-filter-status`, `metrics-filter-team`, and debounced `metrics-filter-q` (~300 ms).
- Sortable column headers `metrics-sort-<field>` that toggle ascending and descending order; empty cells show an em dash.
- Table rows `metrics-row-<type>-<name>` linking to the artifact card; Token Efficiency is labeled "estimate".
- Pagination via `offset` / `next_offset` and export controls `metrics-export-csv` / `metrics-export-json` for signed-in users (anonymous visitors see a sign-in prompt instead).
- Loading, error, and empty states match sibling catalog pages; nav link Metrics opens this route.

## Common tasks

1. Open `/metrics` from the Metrics nav link and scan the four summary cards.
2. Filter by type or status, then type a name fragment in `metrics-filter-q` and wait for debounce.
3. Click Transfer Rate (`metrics-sort-transfer_rate`) to order by impact, then open a row to the card.
4. Set `limit=2` in the URL to page with Next when `next_offset` is present.
5. Sign in and press Export CSV to download rows with the same filters and formula-safe cells.
6. Compare Token Efficiency on the board with the card panel (both show "estimate").

## Permissions

The board follows the catalog public-read rule: anonymous and signed-in viewers see only artifacts allowed by `visibleClause` (team-scoped items stay hidden from outsiders). Export requires a signed-in session cookie or token; anonymous users get a sign-in prompt and MCP tokens are rejected by the API. Totals and pagination never include invisible or purged artifacts. Metrics remain advisory signals—see getting-started/reading-metrics.
