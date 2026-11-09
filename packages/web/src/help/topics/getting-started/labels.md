---
title: Registry labels
summary: Registry labels group artifacts for catalog filters, CLI listing and MCP tag consent without creating a new version.
section: publishing
learn:
  - Which format and limits labels follow
  - Who may edit labels
  - How labels drive filters and facet counts
  - How labels differ from version tags and team access
related: getting-started/visibility, getting-started/teams, actions/artifact/labels-save, pages/catalog
---

**Registry labels** are kebab-case strings stored on the artifact itself (`artifacts.labels`), separate from author **tags** on a version. Labels do not create a new version when edited. Use them for catalog facets, CLI `list --label`, and MCP tag consent matching (a token's `mcp_tags` may match version tags **or** artifact labels without widening visibility).

## Format and limits

- Each label: kebab-case `[a-z0-9]+(-[a-z0-9]+)*`, length 1–32 characters
- At most 20 labels per artifact; duplicates are rejected
- Invalid input returns `400 labels_invalid` from the API and exit code 2 in the CLI

Prefer short stable labels such as `payments` or `team-a` rather than free-form sentences. Labels are not a substitute for lifecycle status or quality grades.

## Who can edit

Same rights as publishing a new version: the **owner**, **maintainers** (co-authors), or **reviewer+/admin**. MCP tokens are rejected on the labels route (`mcp_token_forbidden`). The UI `labels-panel` (`labels-input`, `labels-save`) is hidden when you lack rights; the server remains the authority and returns human-readable errors when a forbidden call slips through.

## Filters and facets

The catalog filters `filter-label` and CLI `skillforge list --label <name>` select artifacts that carry that registry label. Facet counts come from `GET /api/v1/artifacts/facets` and already respect the caller's visibility — the web client must display those counts and must not recompute them from the current page of results.

## Relationship to tags and teams

Author tags live on versions and change only with a publish. Registry labels live on the artifact row and can be updated without a new version.

> [!NOTE]
> Labels do not grant access to team-scoped artifacts; an outsider still receives 404 for invisible team content even if they guess a label name.