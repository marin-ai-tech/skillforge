---
title: Visibility scope
summary: Who can see an artifact with org or team visibility, and how to change its scope safely.
section: access
learn:
  - Who sees org and team artifacts
  - Who may change an artifact's scope
  - Why the unauthenticated marketplace lists only org artifacts
  - What a publish name conflict can still reveal
related: getting-started/teams, getting-started/labels, pages/artifact, actions/artifact/scope-save
---

Every artifact has a **visibility** of `org` (default) or `team`, plus optional `owner_team`. Org artifacts behave like before this change: anyone who can read the registry (including anonymous when public read is on) may see them. Team artifacts are visible only to members of `owner_team`, the owner and co-authors, and **reviewer+/admin**.

## Who sees what

| Actor | org | team (member of owner_team) | team (outsider) |
| --- | --- | --- | --- |
| Anonymous | yes (if public read) | never | never |
| Signed-in outsider | yes | no (404 / hidden) | no |
| Team member / owner / maintainer | yes | yes | — |
| Reviewer / admin | yes | yes (all teams) | yes |

Direct links to invisible artifacts show the normal not-found page — no hint that the name exists. Facet counts and home type counters include only visible artifacts.

## Changing scope

`PUT …/scope` (UI scope panel or `skillforge scope`) changes visibility. Allowed actors: admin; owner who is a member of both current and target teams; or lead of the current team. Narrowing (org→team) and widening (team→org) ask for confirmation in the UI. Changes are audited as `scope_change`. MCP tokens cannot change scope.

## Marketplace without a token

Claude Code marketplace JSON without authentication only lists **org** artifacts. Team plugins install via CLI or an MCP token that can see them. This is intentional residual risk of the design.

## Residual disclosure on publish conflict

Publishing a new artifact whose name collides with someone else's **team** artifact returns `403 not_owner` **without** the `owner` field.

> [!NOTE]
> The fact that the name is taken is unavoidably visible because names are unique in the registry — documented residual leakage.