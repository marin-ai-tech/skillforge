---
title: Hook risk highlight
summary: Highlights the hook table rows that match a risk label such as `llm_hook`. Use it while reviewing a hook to jump from a risk chip to the matching events.
related: getting-started/hook-risks, pages/artifact, actions/quality/tab-quality
---

## What it does

Toggles row highlighting on the hook table for handlers indexed by a risk label such as `llm_hook` or `blocks_tools`. Clicking the same risk again clears the highlight so you can scan other labels.

## When to use

Use while reviewing a hook candidate to jump from a risk chip to the matching event rows without reading every `hooks.json` entry by hand.

## Requires

Available on the Quality tab whenever the selected version includes hook analysis. No special role beyond artifact read access.
