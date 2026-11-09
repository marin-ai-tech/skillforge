---
title: Changing your password
summary: This page changes the password of your own account. Use it after the first sign-in with a seeded admin password or whenever you suspect the password was exposed.
section: ui-workspace
learn:
  - How to change your password and which rules apply
  - What happens to the seeded admin password file
  - What to do if you forgot your current password
related: pages/login
---

## What this page is for

Changing your password updates the scrypt hash for your own account via `POST /api/v1/me/password` with `{ current, next }`. Use it after first login with a seeded admin password, on a schedule, or whenever you suspect exposure. The current password must be correct; the next password must meet the minimum length of eight characters. Successful change keeps you signed in under the existing session policy (sliding TTL, default 30 days). For the seeded admin, the `initial-admin-password.txt` file is deleted on first successful password change.

## What you see

- Current password field.
- New password and confirmation fields (UI may validate match client-side).
- Submit control and success or error feedback (wrong current password, weak next password).
- Link back to catalog or home after success.
- No display of the stored hash; only whether the change succeeded.

## Common tasks

1. Sign in and open Changing your password from the user menu.
2. Enter your current password exactly.
3. Choose a new password of at least eight characters and confirm it.
4. Submit and verify you can sign out and sign back in with the new password.
5. If you are admin after bootstrap, confirm `initial-admin-password.txt` is gone after the first change.
6. If you forgot the current password, ask an admin to reset it from Users administration.

## Permissions

Requires sign-in as the account owner (any role: viewer, contributor, reviewer, admin). Admins reset other users' passwords on the Users administration page, which is separate from this self-service form. No sign-in means you cannot reach this page usefully—use Sign in first.
