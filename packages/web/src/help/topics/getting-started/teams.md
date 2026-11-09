---
title: Teams
summary: How teams group people who share private artifacts, and what members, leads and admins can do.
section: access
learn:
  - Who can create and delete teams
  - What members and leads can do
  - Which artifacts team members see
  - How to manage teams from the UI and CLI
related: getting-started/visibility, getting-started/labels, pages/teams, actions/teams/team-create
---

SkillForge **teams** group people who share private artifacts. A team has a kebab-case name (at most 40 characters), optional display name and description, and members with role **member** or **lead**. Any user role (including viewer) may be a team member so they can see team-scoped artifacts.

## Creating and deleting teams

Only an **admin** can create a team (`POST /api/v1/teams` or the Teams page / CLI `skillforge teams create`). Creation requires an initial **lead** who must be an existing enabled user. Duplicate names return `team_exists`; invalid names return `name_invalid`. Admins delete teams only when no artifact still references them as `owner_team` (`team_in_use` otherwise).

## Roles: member and lead

- **member** — sees team artifacts, appears in the member list for fellow members and admins.
- **lead** — everything a member can do, plus add/remove members and change roles (with admin). The last lead cannot be removed (`last_lead`).

Member changes apply immediately on the next request. Teams are capped at 500 members (`team_full`).

## What members see

Team members see `visibility=team` artifacts owned by any of their teams (including candidate). Reviewers and admins see all team artifacts for moderation. Outsiders and anonymous users never see team artifacts — not in the catalog, facets, marketplace, or direct links (404, same as missing).

## CLI and UI

Use **Teams** in the nav (signed-in only), or CLI: `teams list|show|create|add|remove`. Errors such as `last_lead` appear as human-readable text next to the action in the UI.

## Availability for teams

On an artifact's page, **Availability for teams** (`availability`) sets the artifact for each team: not available, available (the default), installed by default, or required. Admins change it for any team, a team's lead for their own team; every change goes to the audit log. `skillforge sync` installs what the user's teams require or install by default, `--prune` keeps required artifacts, `skillforge uninstall` refuses to remove a required one without `--force`, and `skillforge install` refuses an artifact that is not available for the user's teams without `--force`. For someone in several teams the most permissive state wins. Only active artifacts count.

> [!NOTE]
> Availability guides installation; it does not hide anything. To keep an artifact from other teams, use its visibility.
