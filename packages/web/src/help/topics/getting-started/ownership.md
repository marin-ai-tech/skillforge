---
title: Owners and co-authors
summary: Every artifact has one owner and optional co-authors. This guide explains who may publish new versions and how to transfer ownership.
section: access
learn:
  - Who may publish a new version of an existing artifact
  - How to transfer ownership and manage maintainers
  - When reviewer and admin overrides apply
  - What happens when a maintainer's role is lowered
related: getting-started/roles, pages/artifact, actions/artifact/transfer-owner
---

Every SkillForge artifact has exactly one **owner** (a username) and zero or more **maintainers** (co-authors). Ownership is separate from `created_by` (who first published) so a transfer does not erase history. The owner and maintainer names appear on the artifact card for anyone who can open it.

## Who can publish versions

Publishing a **new version of an existing** artifact is allowed when:

- you are the **owner**, or
- you are listed as a **maintainer**, or
- your role is **reviewer** or **admin** (an audited `publish_override`).

A first-time publish (artifact does not exist yet) makes the publisher the owner. Contributors who are neither owner nor maintainer receive `403 not_owner` from the API and a clear CLI message naming the owner.

## Transfer ownership and maintainers

The ownership panel on the artifact card is visible only to the current **owner** and to **admin**. From that panel you can:

- transfer ownership (new owner username + required reason, confirmed in a dialog — not a browser `confirm`);
- add a maintainer (must be an enabled user with contributor role or higher, and not the owner);
- remove a maintainer.

Reviewers can publish with override but **cannot** manage ownership. MCP API tokens are rejected on ownership routes (`mcp_token_forbidden`).

## Reviewer and admin override

When a reviewer or admin publishes into someone else's artifact, the server still accepts the version and writes an audit event `publish_override` with the actor role and the owner name.

> [!TIP]
> Use this for urgent fixes; prefer asking the owner to add you as a maintainer for routine work.

## Role demotion of a maintainer

If a maintainer's global role is later lowered to **viewer**, their name stays on the maintainers list, but they cannot publish (the route still requires contributor+). Raising the role again restores publish rights without re-adding them — intentional and documented.

## Local auth mode and plugins

Artifacts created while `authMode=local` belong to the user `local`. After switching to password auth, only an **admin** can transfer those artifacts.

> [!WARNING]
> Server plugins are trusted code with full database access; the ownership rule does not sandbox them.

## Artifacts without an owner

When an admin disables a person who owns artifacts, every active admin gets a notification, and the Users page lists those artifacts under **Artifacts without an owner** (`orphans`), together with artifacts whose owner no longer exists. Each row suggests the first active co-author; **Hand over** makes the chosen person the owner and records the previous owner in the audit log. Retired and purged artifacts are not listed. Turning the person back on clears their artifacts from the list.
