---
title: Delete my session facts
summary: Deletes every session usage fact you uploaded to the registry; local transcripts on your machine are untouched. Use it to remove privacy-sensitive usage data or test imports.
related: getting-started/session-metrics, pages/me, actions/me/menu-me
---

## What it does

Removes every session usage fact attributed to your signed-in account from the registry (`DELETE /api/v1/me/session-facts`). Artifact metrics such as sessions count and Verification Pass Rate update for other readers. Local Claude Code transcripts on your machine are never touched.

## When to use

Use when you want to clear privacy-sensitive usage attribution you previously uploaded with `skillforge sessions import`, or after testing imports on a shared registry.

> [!CAUTION]
> Confirm in the dialog; the action cannot be undone from the UI.

## Requires

Requires sign-in as the same user who uploaded the facts. MCP tokens cannot call this route. Optional `?source=` filter deletes only facts from that harness source.
