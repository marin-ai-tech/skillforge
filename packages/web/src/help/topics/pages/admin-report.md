---
title: Report for management
summary: The report shows who uses which skills over a period, by consuming team and by artifact, with the trend, an estimate of context tokens and the active artifacts nobody used.
section: ui-admin
learn:
  - How sessions are counted by consuming team
  - How the change against the previous period works
  - How the context token estimate is made
  - Which artifacts the report suggests removing
related: pages/metrics, getting-started/quality, pages/admin-audit
---

## What this page is for

The report answers the questions a manager asks about skills: who uses what, whether use grows, what it costs in context and what can go. It is built from session usage facts (`session_facts`) that agents report, and only counts them: no prompts, paths or content. Choose a period of 7, 30, 90 or 365 days; every figure is compared with the previous period of the same length.

## What you see

- Totals (`report-totals`): sessions with the change, people who reported use, active artifacts.
- Sessions by week (`report-trend`).
- A table by consuming team (`report-teams`): sessions of each team's members, people and a context token estimate. A person in two teams counts in both; people without a team have their own row.
- A table by artifact (`report-artifacts`), most used first.
- Artifacts nobody used in the period (`report-unused`): active, aging or zombie artifacts without a single session. One published inside the period is marked, because it may simply be new.

## Common tasks

1. Open the report from the user menu (`menu-admin-report`) or go to `/admin/report`.
2. Pick the period in `report-days` and read the change against the previous one.
3. Share the team table to split costs between teams.
4. Review the unused list and retire what no one needs through the usual lifecycle transitions.
5. Pull the same data as JSON with `GET /api/v1/admin/report?days=30`.

> [!NOTE]
> The context token estimate is sessions × (every turn + when used) from the Quality tab: a session saw the description at least once and read the body once. Real use can be higher, because the number of turns is unknown.

## Permissions

Requires role admin, because the report shows use by people and teams. Reviewers and other roles get 403 from the API and see the forbidden state here; anonymous visitors are sent to sign in.
