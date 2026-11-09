---
title: Install hint from agent
summary: Shows a copyable `skillforge install` command for snapshot rows that are outdated or exist only in the registry. Use it to bring registry content onto the machine the snapshot came from.
related: pages/me-agent, getting-started/cli, getting-started/install
---

## What it does

Shows `skillforge install <type>/<name>` with a Copy button for outdated or registry-only rows so you can bring registry content onto a machine.

## When to use

Use this when the snapshot is behind the catalog or missing an active (or all-status) registry artifact you want locally.

## Requires

No special role beyond viewing the agent page. Install itself runs in your CLI against the registry URL.