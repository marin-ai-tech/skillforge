---
title: Roles
summary: The four roles that decide what each user may do, from reading the catalog to administering users. Read it before granting access.
section: start
learn:
  - What viewer, contributor, reviewer and admin can each do
  - How sessions and API tokens inherit the owner's role
  - Which role to grant to authors, reviewers and read-only stakeholders
related: getting-started/overview, pages/users
---

SkillForge authorization is role-based with a total order: **viewer** < **contributor** < **reviewer** < **admin**. A higher role may perform any action allowed to a lower role. Passwords are scrypt-hashed; usernames are 2-32 characters of `a-z0-9-_.`.

## viewer

Read catalog and artifact pages when access policy allows. Cannot **publish** (`POST /api/v1/artifacts` returns 403). Can sign in, manage their own API tokens (tokens inherit viewer limits), and change their own password.

## contributor

All viewer powers plus **publish** of new immutable versions. This is the default role for authors uploading skills, commands, agents, and hooks through the UI or CLI Bearer tokens.

## reviewer

All contributor powers plus lifecycle governance gates (moving candidate toward active and participating in review queues). Home's awaiting-review list is aimed at this role.

## admin

Full power including Users administration: create users, assign roles, disable accounts, reset passwords. Cannot remove the last active admin (`409 last_admin`). Seeds on empty databases as user `admin`.

## Sessions and tokens

Browser sessions use HttpOnly cookie `sf_session` (sliding TTL, default 30 days). API tokens `sf_…` act as the owner with the owner's role—contribute publish only if that role is contributor or higher. Rate limit: more than ten failed logins per username in fifteen minutes yields 429. Disabled users get 423 on login and 401 on existing sessions and tokens.

## Choosing a role

Grant contributor to authors who need to publish; grant reviewer to people who endorse candidates; keep admin tightly held. Viewers are fine for read-only stakeholders when public read is disabled. Role changes happen on Users administration and take effect on subsequent authorization checks.
