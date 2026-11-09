# SkillForge documentation

Start with the user guide if you publish or install artifacts, and with self-hosting if you run the registry. The
handbook explains each role. The topic guides go deep on one part of the registry, and the cookbook collects short
recipes.

## 🚀 Start here

- [Why SkillForge](01-why-skillforge.md) — the problem it solves and how.
- [User guide](02-user-guide.md) — publish, review and install artifacts.
- [Self-hosting](03-self-hosting.md) — install, configure, upgrade and back up the registry.
- [Handbook](handbook/README.md) — what a viewer, contributor, reviewer and admin do.
- [Glossary](glossary.md) — check a term while you read.

## 🧭 Guides by topic

- [Artifact types](05-artifact-types.md) — the seven types, their files and validation codes.
- [Publishing and import](06-publishing-and-import.md) — the Publish page, the CLI, imports, mirrors, starter packs.
- [Lifecycle and review](07-lifecycle-and-review.md) — statuses, transitions, the review queue and the lifecycle board.
- [Lifecycle by data](08-lifecycle-by-data.md) — how usage, quality and age move artifacts along.
- [Quality and security](09-quality-and-security.md) — the quality score, hook risks, the security scan and policies.
- [Versions and channels](10-versions-and-channels.md) — immutability, stable and beta, pins, diffs and rollback.
- [Teams, visibility and ownership](11-teams-visibility-ownership.md) — who sees, owns and must install what.
- [Agents and inventory](12-agents-and-inventory.md) — agent snapshots, the organization inventory, shadow MCP servers.
- [MCP](13-mcp.md) — the registry as an MCP server, and MCP servers as artifacts.
- [Plugins](14-plugins.md) — extend the server; the review-assistant plugin.
- [Metrics dashboard](15-metrics-dashboard.md) — adoption, value and cleanup at a glance.
- [Session metrics](16-session-metrics.md) — usage facts from local agent sessions.
- [Skill evals](17-skill-evals.md) — eval suites, runners and the acceptance gate.
- [Orchestration](18-orchestration.md) — workflows, routines and platform hooks.
- [Metadata and purge](19-metadata-and-purge.md) — edit metadata without a version; remove data for good.
- [Backups and operations](20-backups-and-operations.md) — backups, health, diagnostics, logs, the LLM settings.

## 🔌 Agents

- [Agents overview](agents/README.md) — compare the supported agents.
- [Claude Code](agents/claude-code.md), [Codex](agents/codex.md), [Gemini CLI](agents/gemini-cli.md),
  [Cursor](agents/cursor.md), [OpenCode](agents/opencode.md), [Qwen Code](agents/qwen-code.md),
  [Devin](agents/devin.md), [Reckon](agents/reckon.md).

## 💡 Recipes and checks

- [Cookbook](21-cookbook.md) — short recipes for common tasks.
- [Manual test cases](22-manual-test-cases.md) — walk through the main flows by hand.

## 🏗️ Design

- [Architecture](04-architecture.md) — the packages, the data and how a request flows.
