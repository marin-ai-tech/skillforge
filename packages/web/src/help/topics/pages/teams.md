---
title: Teams page
summary: The Teams pages list registry teams and their members. Admins create teams here, and team leads or admins add and remove members.
section: ui-workspace
learn:
  - What the team list and team page show
  - How to create a team and manage its members
  - Who may create teams, manage members and see member lists
related: getting-started/teams, actions/teams/team-create, actions/teams/team-member-add
---

## What this page is for

The Teams area lists registry teams and lets admins create new ones. Opening a team shows members (to members and admins) and lets leads or admins add or remove people.

## What you see

- `/teams` — list with membership hints; **Create** (`team-create`) only for admin
- `/teams/:name` — member list when allowed; add/remove controls for lead/admin
- Nav link `nav-teams` only when signed in; anonymous visitors are sent to login

## Common tasks

1. Admin creates a team with an initial lead.
2. Lead adds collaborators as member or lead.
3. Lead removes a member; attempting to remove the last lead shows a clear error and keeps membership unchanged.

## Permissions

Create/delete team: admin. Manage members: lead of that team or admin. Viewing the member list: team members and admin; other signed-in users see the team without members. API errors such as last_lead, team_full, and member_invalid appear as human-readable text next to the control that failed.
