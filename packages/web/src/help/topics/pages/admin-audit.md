---
title: Audit log
summary: The audit log shows who did what in SkillForge — artifact events and changes to policies, users, LLM settings and mirrors — and exports it for a SIEM.
section: ui-admin
learn:
  - Which events the log contains
  - How to filter by action and person
  - How a SIEM pulls only new events with a cursor
  - What never reaches the log
related: pages/users, pages/admin-lifecycle, pages/admin-assistant
---

## What this page is for

The audit log is one place for security teams to answer "who did what and when". It merges two streams in time order: artifact events (publish, transition, owner change) that you also see on an artifact's Audit tab, and system events that are not about one artifact — import policy (`import_policy_change`), security policy (`security_policy_change`), LLM settings (`llm_settings_change`), users (`user_create`, `user_update`) and mirrors (`mirror_create`, `mirror_delete`). Secrets never reach the log: for LLM settings only the names of the changed fields are kept, and a password change shows as `password_changed`.

## What you see

- Filters for the action and for the person who acted (`audit-action`, `audit-actor`).
- A table (`audit-table`) with time, person, action, subject (an artifact link or the user, mirror or policy the event names) and details.
- A Load more button (`audit-more`) that shows the next 100 events.
- A Download NDJSON link (`audit-export`) that saves the whole log with the current filters, one JSON event per line.

## Common tasks

1. Open the log from the user menu (`menu-admin-audit`) or go to `/admin/audit`.
2. Type an action such as `user_update` to see who was disabled or had a role changed.
3. Download NDJSON for an archive or a one-off investigation.
4. For a SIEM, pull `GET /api/v1/admin/audit` with an admin token: each page has `next`; pass it back as `after` to get only the events that came later. A broken cursor returns 400.

> [!NOTE]
> System events are recorded from the version that added this log. Changes made earlier are only in the server's process log.

## Permissions

Requires role admin, because the log shows user names and policies. Reviewers and other roles get 403 from the API and see the forbidden state here; anonymous visitors are sent to sign in.
