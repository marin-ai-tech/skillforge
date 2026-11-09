---
title: Add agent from folder
summary: Uploads a local agent folder from the browser as a named snapshot for the chosen runtime. Use it instead of `skillforge agent scan` when the folder is readable by your browser.
related: pages/me-agents, getting-started/agents, getting-started/agent-support
---

## What it does

Opens a dialog to name a snapshot, pick a runtime (any runtime of the server table, see [Agent support](getting-started/agent-support); Claude Code is the default, Generic covers folders that follow no client layout), choose a local directory via `webkitdirectory`, upload files (lock file parsed separately), and navigate to the new agent on success.

## When to use

Use this when the agent folder is readable by the browser and you prefer UI upload over `skillforge agent scan`. Skip `node_modules` and `.git` automatically. Only files that make up artifacts are uploaded; other files of the folder, such as `settings.local.json`, `auth.json`, or `.env`, stay in the browser. Folders of other clients (`.codex`, `.cursor`, `.opencode`, `.qwen`, …) are imported like `.claude`; Codex TOML agents and TOML commands are converted to the canonical format, and items installed with translation compare as `in_sync` through the lock. From the CLI, `skillforge agent scan --runtime <id> --name <name>` scans that runtime's project folder by default.

## Requires

Signed-in user. Name must be kebab-case. Large folders still respect client size limits.