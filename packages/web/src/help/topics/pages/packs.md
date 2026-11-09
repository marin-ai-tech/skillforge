---
title: Team method packs
summary: A method pack is how a team works as one versioned set of roles, each with artifacts at pinned versions, installed with a single command and kept at those versions by sync.
section: ui-catalog
learn:
  - What a pack and its roles contain
  - How to publish a new pack version
  - How to install a pack or one role
  - Why sync keeps pack versions
related: getting-started/cli, getting-started/versions-and-digests, pages/catalog
---

## What this page is for

Teams want to adopt a whole way of working — how they plan, build and review — not a loose set of skills. A pack captures it: a name, a version, a title and roles such as `developer` or `reviewer`, each listing skills, commands, agents or hooks at exact versions (workflows come with the artifacts that carry them). Pack versions never change once published, so everyone who installs `team-method@1.0.0` gets the same files, even after newer artifact versions appear in the catalog.

## What you see

- The list of packs (`pack`) with title, name and latest version.
- Opening a pack (`pack-open`) shows its roles (`pack-role`) with the pinned artifacts and a ready install command for each role.
- An empty state (`packs-empty`) when no pack has been published.

## Common tasks

1. Open the page from the user menu (`menu-packs`) or go to `/packs`.
2. Copy the command for your role, for example `skillforge pack install team-method@1.0.0 --role developer`, and run it in your project. Without `--role` every role is installed.
3. Keep working as usual: `skillforge sync` does not move the pinned versions; installing a newer pack version moves them.
4. To publish a pack, send `POST /api/v1/packs` with `name`, `version`, `title`, `description` and `roles`; every item must exist at that version, be active and be visible to the whole organisation.

> [!NOTE]
> A new version must be higher than the latest one, and only the pack's owner or an admin can publish it. Use `skillforge pack list` to see packs from the terminal.

## Permissions

Everyone signed in can see packs and install them. Contributors and above can publish a new pack; a new version of an existing pack is published by its owner or an admin. Anonymous visitors are sent to sign in.
