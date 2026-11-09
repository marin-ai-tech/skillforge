---
title: Home
summary: The SkillForge dashboard shows artifact counts by type, recent publications and the review queue. Start here to see what changed and what needs attention.
section: ui-catalog
learn:
  - What the type counts, recent and awaiting-review regions show
  - When the delete-today board appears for reviewers
  - How to jump from Home into filtered Catalog views
  - How to add the registry to the Claude Code plugin marketplace and where other agents install from
related: getting-started/overview, pages/catalog, pages/lifecycle
---

## What this page is for

The home page at `/` is the SkillForge dashboard. It answers ablation-first questions quickly: how many artifacts exist per type, what was published recently, which candidate items await a reviewer, and—for reviewer+—whether aging or zombie work needs attention on the delete-today board. Type counts deep-link into Catalog filters so you never hand-edit query strings. Use Home at the start of a session before browsing, publishing, or opening Lifecycle. Empty registries show guidance toward Publishing an artifact.

## What you see

- Type count controls `home-count-<type>`, one per artifact type of the registry (for example `home-count-skill`, `home-count-plugin`, `home-count-mcp-server`), each linking to `/artifacts?type=<type>`.
- A Recently published region `home-recent` with up to eight `artifact-card` entries ordered by `updated_at` descending.
- An Awaiting review region `home-review` with up to eight cards whose status is `candidate`.
- For reviewer+, `home-delete-board` when aging or zombie counts are non-zero, linking to `/lifecycle?tab=delete`.
- A Claude Code plugin marketplace block `home-install` with the marketplace add command from `/api/v1/install-info` and a hint on how other agents install artifacts.
- Cards show type and status chips, truncated description, up to four tags, `latest_version`, and relative time.
- Empty registries render `empty-state` with a publish hint; the browser tab title begins with SkillForge.
- A footer `home-version` at the bottom with the running SkillForge version from `/api/v1/health`; if that request fails, the page has no footer.

## Common tasks

1. Open `/` after sign-in, or anonymously when public read allows.
2. Click a type count to open Catalog filtered by that type.
3. Open a recently published card to inspect Overview, Files, Versions, Audit, and lifecycle.
4. Work the awaiting-review list or jump to `/lifecycle?tab=review` when you are a reviewer.
5. Follow `home-delete-board` when aging or zombie counts appear after a sweep.
6. Press Ctrl/Cmd+K to focus header search and jump to Catalog with a query.
7. In Claude Code, the only agent with a plugin marketplace, run the Home marketplace command, then install active plugins from artifact Install tabs. For any other agent, pick it on the Install tab of an artifact.

## Permissions

Readable whenever catalog read is allowed: public read mode or any signed-in role (viewer, contributor, reviewer, admin). Publishing still requires contributor or higher. Lifecycle endorsement and the delete-today shortcut require reviewer or admin. No special home-only privilege exists.
