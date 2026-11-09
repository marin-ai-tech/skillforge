---
title: Users administration
summary: Users administration is where admins create accounts, change roles, reset passwords and disable users. Use it to onboard people, grant reviewer rights or lock compromised accounts.
section: ui-admin
learn:
  - What the user list and source chips show
  - How to create a user and change a role
  - When a password reset is available
  - Why the last active admin cannot be removed
related: getting-started/plugins, getting-started/roles, actions/users/create, getting-started/self-hosting, getting-started/sso
---

## What this page is for

Users administration is the admin-only UI for listing accounts, creating password users, changing roles, resetting passwords, and disabling accounts. It maps to `/api/v1/admin/users`. Use it to onboard contributors, grant reviewer rights for lifecycle gates, or lock compromised accounts. The UI prevents destroying the last active administrator (`409 last_admin`). Duplicate usernames return `409 username_taken`. Passwords are stored only as scrypt hashes; plaintext never appears in logs or audit. Each row shows an account source chip so you can tell password accounts from OIDC-provisioned identities and the built-in local user.

## What you see

- A list of users showing username, source (`Password`, provider label such as `Test IdP` / `Google`, or `Local`), display name, role (viewer / contributor / reviewer / admin), disabled flag, and timestamps.
- Create-user form: username, password (minimum eight characters), role, optional display name (password accounts only).
- Per-user actions: change role, reset password (hidden for OIDC and local accounts), disable or enable, with confirmation dialogs where destructive.
- Artifacts without an owner (`orphans`): artifacts of disabled people and of owners that no longer exist, each with a suggested co-author and a Hand over action that makes the chosen person the owner and records the previous owner in the audit log ([details](getting-started/ownership)).
- Empty and error states consistent with the rest of the catalog UI; help button opens this topic.

## Common tasks

1. Sign in as admin and open Users administration.
2. Create a user with role contributor so they can publish.
3. Promote a trusted user to reviewer when they should move artifacts from candidate to active.
4. Reset a password (still enforce at least eight characters) when a password-account user is locked out.
5. Disable a user after offboarding; their sessions and tokens stop working. Disabled SSO users see `sso_account_disabled` on next IdP login. If they owned artifacts, hand them over in the `orphans` block.
6. Avoid demoting or disabling yourself if you are the last active admin. Review source chips before resetting passwords—SSO accounts have no SkillForge password.

## Permissions

Requires role admin. Contributor, reviewer, and viewer receive 403 forbidden on admin APIs. Anonymous users get 401. Creating users and assigning publish-capable roles is an admin responsibility; reviewers do not manage accounts. Self-service password changes belong on Changing your password. For Docker installs, upgrades, OIDC env vars, and data archives see Self-hosting and Single sign-on (OIDC).