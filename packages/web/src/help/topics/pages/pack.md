---
title: Method pack page
summary: One method pack — its roles at a chosen version, who published each version and when, what changed between two versions, and a form for the owner to check and publish a new version.
section: ui-catalog
learn:
  - What the pack page shows
  - How to compare two versions
  - How to check and publish a new version
related: pages/packs, getting-started/cli
---

## What this page is for

A method pack is how a team works, as roles with artifacts at pinned versions. This page is where you read one pack in full and where its owner moves it forward.

## What you see

- The header (`pack-header`): the pack name, the owner, the latest version and when it was updated.
- Roles (`pack-roles`) of the version chosen in **Version** (`pack-version-select`, the latest by default; the choice is kept in the address as `?version=`), with the pinned artifacts and a ready `skillforge pack install` command for each role.
- Versions (`pack-versions`): every version with who published it and when.
- Compare versions (`pack-compare`), when there are two or more versions: a role added or removed, an item added or removed, an item moved to another version (`0.1.0 → 0.2.0`).
- An unknown pack shows **Pack not found** (`pack-not-found`) with a link to all packs.

## Common tasks

1. To publish a new version, the owner or an admin presses **New version** (`pack-new-version`). The form is filled from the latest version, with the next patch version suggested.
2. Edit the roles: each role has a name, a description and its items, one per line as `type/name@version`, for example `skill/plan-it@0.2.0`.
3. Press **Check** (`pack-check`). The registry lists every problem at once (`pack-problems`): an item not found, not active, not visible to the whole organization or with security findings not cleared, and problems of the pack itself (not the owner, a version not higher than the latest). Nothing is published by a check.
4. **Publish** (`pack-publish`) becomes available after a successful check of exactly the current content; any edit needs a new check. After publishing, the page shows the new version.

> [!TIP]
> The same check runs from a terminal: `skillforge pack publish pack.json --dry-run`; `skillforge pack show <name>[@version]` prints a version with its roles.

## Permissions

Everyone signed in can read a pack. A new version is published by the pack's owner or an admin. An artifact you cannot see is reported as not found.
