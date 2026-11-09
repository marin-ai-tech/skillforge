---
title: Export metrics CSV
summary: Downloads the metrics board as CSV with the current filters and sort. Use it for a spreadsheet snapshot of registry metrics.
related: pages/metrics, getting-started/reading-metrics
---

## What it does

Downloads the metrics board as CSV (`metrics-export-csv`) using the same filters and sort as the current URL. The server returns UTF-8 CSV with formula-injection guards on string cells and a Content-Disposition attachment filename.

## When to use

Use when you need a spreadsheet snapshot of the filtered registry metrics without copying the HTML table. Prefer CSV for Excel/Sheets; use JSON export for scripts.

## Requires

Signed-in session (cookie). Anonymous users see a sign-in prompt; MCP tokens cannot call the export API.
