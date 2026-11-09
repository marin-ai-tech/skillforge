---
title: Sign in
summary: Sign in starts a session with a SkillForge account, a corporate directory (LDAP) or single sign-on (OIDC). You need it before publishing, managing tokens or doing admin work.
section: ui-other
learn:
  - How to sign in with a password, LDAP or an OIDC provider
  - What the sign-in errors and rate limiting mean
  - How long sessions last and how to sign out
  - Why to change the seeded admin password after first boot
related: getting-started/roles, pages/password, getting-started/sso
---

## What this page is for

Sign in creates a server-side session and sets cookie `sf_session` (HttpOnly, SameSite=Lax, Path=/; Secure when the base URL is https). Use it before publish, token management, password changes, or admin work. Failures return uniform `invalid_credentials`; disabled users get 423 for password login or 403 `account_disabled` for LDAP; more than ten failures per username in fifteen minutes return 429 `rate_limited` even with a correct password. Sessions slide with `SKILLFORGE_SESSION_TTL_DAYS` (default 30) and survive server restart. Seeded admin appears on empty databases. When OIDC or LDAP providers are configured, this page also starts single sign-on or corporate directory login without storing IdP passwords in SkillForge.

## What you see

- Optional login-method switcher (`login-method-password` labeled “SkillForge account”, plus `login-method-<id>` for each LDAP provider) when LDAP is configured; the same username and password fields post to password login or `POST /api/v1/auth/ldap/:id/login`.
- Username and password fields (new passwords must be at least eight characters long).
- Optional OIDC provider buttons (`login-sso-<id>`, labeled “Sign in with <label>”) below the password form when `GET /api/v1/auth/providers` lists OIDC providers.
- Submit control establishing the session cookie.
- Error messaging for invalid credentials, disabled accounts, rate limiting, LDAP unavailability (`ldap_unavailable`), and SSO codes (`sso_state`, `sso_denied`, `sso_token`, `sso_invalid_token`, `sso_account_disabled`) via `?error=` without revealing whether a username exists.
- After success, navigation continues to the safe relative `next` path (open redirects like `//evil` are blocked).
- In local single-user mode this page redirects home; the user menu shows a `local-mode` chip instead of logout.

## Common tasks

1. Open Sign in from the user menu or when a write action redirects you.
2. If LDAP methods appear, choose Corporate account (or your org label), enter directory username and password, then submit.
3. Prefer an OIDC provider button when your organization uses Google or another OIDC IdP.
4. Or choose SkillForge account, enter username (2-32 chars: a-z, 0-9, hyphen, underscore, dot) and password, then submit.
5. If an SSO or directory error banner appears, retry or contact an admin.
6. If rate limited on password login, wait for the fifteen-minute window before retrying.

> [!WARNING]
> After first boot, change the seeded admin password from env or `initial-admin-password.txt`.

## Permissions

No sign-in is required to view this page. Successful authentication grants viewer, contributor, reviewer, or admin as stored on the user (or mapped from IdP/LDAP groups). Logout via the user menu calls `POST /api/v1/auth/logout` and clears the session (hidden in local mode). API tokens are separate credentials managed after you sign in. See Single sign-on (OIDC and LDAP) for provider configuration.