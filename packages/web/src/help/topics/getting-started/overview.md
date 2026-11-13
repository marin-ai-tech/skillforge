---
title: Getting started
summary: What SkillForge is, what you can do in it and the core ideas behind it. Start here, then follow the suggested first hour.
section: start
learn:
  - What the registry stores and why it is ablation-first
  - The core ideas of identity, immutability, lifecycle, provenance and roles
  - What to do in your first hour
  - Which packaging limits to remember
related: getting-started/upload-artifacts, getting-started/artifact-types, pages/help, getting-started/roles, getting-started/self-hosting, getting-started/agent-support
---

SkillForge is a self-hosted registry for production-grade agent capabilities: composable skills, slash-style commands, subagents, verification hooks, Claude Code plugin bundles, settings profiles and descriptions of approved MCP servers. The product stance is ablation-first—"What can you delete today?"—so every artifact is named, versioned, and attributable rather than an anonymous snippet pile.

## What you can do

Browse the catalog of eight artifact types, open immutable versions with digests, publish new packages when you have the contributor role, manage sessions plus API tokens, and open My workspace (`/me`) for a personal cabinet of your artifacts, agents, token counts, and recent activity. Home shows type counts, recently published cards, and candidates awaiting review. Catalog filters (type, search, status, team, owner, label, agent) live in the URL, and the type tabs count with the same filters. The artifact page renders Overview markdown, Files, Versions with a version compare, Audit, Install, Quality (score, security scan, context cost), Evidence and Comments. Publish validates packages with stable Blocking `E_*` and Warning `W_*` codes, scans content for risky patterns and signs every version, and `skillforge install` checks the signature before writing files. Teams publish method packs (`/packs`): roles with skills, commands and agents at pinned versions. Administrators get a report for management (`/admin/report`), an inventory of what stands on people's machines (`/admin/inventory`), a pull-request rollout to repositories (`/admin/rollout`) and rules collected from past reviews (`/admin/harvest`). The CLI suggests skills for a project (`skillforge suggest`), drafts a skill from your sessions (`skillforge harvest`) and keeps your own layers of edits over published files. Help is available on every page via `?`, tips on controls, and the `/help` center.

## Core ideas

- **Identity**: pair of type + name (kebab-case). Skill `deploy` and command `deploy` are different artifacts.
- **Immutability**: each publish creates a semver version with a content digest; versions are never overwritten.
- **Lifecycle**: candidate to active (via reviewer) to aging to zombie to retired, with a delete-today board mindset for ablation.
- **Provenance**: human, reckon, agentspace, dreamteam, or import on each version.
- **Roles**: viewer < contributor < reviewer < admin; publish needs contributor+.

## Suggested first hour

1. Sign in (seeded admin on fresh installs) and open My workspace (`/me`) from the user menu.
2. Open Getting started topics for artifact types, lifecycle, and roles.
3. Browse Catalog; open one artifact and switch versions.
4. Create an API token if you will use the CLI.
5. Publish a tiny skill with valid frontmatter.
6. Skim Home awaiting-review if you hold reviewer.

> [!NOTE]
> Operators who run SkillForge themselves should also read Self-hosting, upgrades and backups for Docker, environment variables, and restore with tar.

Limits to remember while packaging: 32 MiB bundle, 16 MiB per file, 1000 files, names 1-64 `a-z0-9-`, descriptions at most 1024 characters. Canonical layouts place skills under `skills/<name>/SKILL.md`, commands under `commands/<name>.md`, agents under `agents/<name>.md`, hooks under `hooks/hooks.json`, plugins under `.claude-plugin/plugin.json`, settings profiles under `settings/<name>/settings.json`, and MCP servers under `mcp/<name>/MCP.md` with `server.json`.