---
title: Export metrics JSON
summary: Downloads the metrics board as JSON with the current filters and sort. Use it for scripts and pipelines that consume JSON.
related: pages/metrics, getting-started/reading-metrics
---

## What it does

Downloads the metrics board as JSON (`metrics-export-json`) with `generated_at`, `truncated`, `columns`, and `items`, using the same filters and sort as the page.

## When to use

Use for automation or pipelines that already consume JSON. Prefer CSV when sharing with spreadsheet users.

## Requires

Signed-in session (cookie). Anonymous visitors must sign in; MCP tokens are forbidden on the export route.
