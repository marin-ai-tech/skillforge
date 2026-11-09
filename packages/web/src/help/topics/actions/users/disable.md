---
title: Disable user
summary: Disables a user account so that its sessions and sign-ins stop working. Use it for offboarding or when an account may be compromised.
related: pages/users
---

## What it does

Sets disabled true after confirmation. Existing sessions fail auth and login returns 423. Cannot disable the last active admin (409 last_admin).

## When to use

Use for offboarding or compromise response.

## Requires

Requires sign-in as admin.
