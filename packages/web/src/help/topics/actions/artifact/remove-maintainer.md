---
title: Remove maintainer
summary: Removes a co-author from the maintainers list, ending their right to publish versions. Use it when a collaborator leaves the project or should no longer release.
related: getting-started/ownership, actions/artifact/add-maintainer
---

## What it does

Removes one co-author from the maintainers list via `DELETE /api/v1/artifacts/:type/:name/maintainers/:username`. They immediately lose owner/maintainer publish rights (reviewer+ can still override).

## When to use

Revoke publish delegation when a collaborator leaves the project or should no longer push versions. Demoting their global role to viewer is a separate action and does not remove them from this list.

## Requires

Current owner or admin; browser session or a non-MCP API token.
