---
title: Single sign-on (OIDC and LDAP)
summary: How to sign users in through OpenID Connect or LDAP and Active Directory, and map directory groups to SkillForge roles.
section: access
learn:
  - How to configure an OIDC provider or the Google preset
  - How to configure LDAP or Active Directory
  - How roles are mapped from groups and claims
  - How SSO users are provisioned and which errors to expect
related: pages/login, pages/users, getting-started/self-hosting, getting-started/roles
---

SkillForge can authenticate users through OpenID Connect providers and through corporate LDAP or Active Directory. Configure providers with environment variables—there is no plugin surface for login. Google has a built-in OIDC preset so you only need a client id and secret. LDAP uses a service account to search for the user, then binds as that user DN with the password they typed.

## Configuring an OIDC provider

Set `SKILLFORGE_OIDC_PROVIDERS` to a JSON array of provider objects. Each object needs `id` (kebab-case), `label`, `issuer`, `client_id`, and `client_secret`. Optional fields: `scopes` (default `openid email profile`), `role_claim`, `role_map`, and `default_role` (default `viewer`). When any OIDC provider is configured you must also set `SKILLFORGE_PUBLIC_URL` to the public origin browsers use.

> [!IMPORTANT]
> The redirect URI registered at the IdP must be exactly `<SKILLFORGE_PUBLIC_URL>/api/v1/auth/oidc/<id>/callback`.

## Google preset

Set `SKILLFORGE_GOOGLE_CLIENT_ID` and `SKILLFORGE_GOOGLE_CLIENT_SECRET` together. SkillForge adds a provider with id `google`, label `Google`, and issuer `https://accounts.google.com`. Register the Google Cloud OAuth client with the redirect URI for id `google` under your public URL. Discovery and JWKS are fetched lazily on the first sign-in attempt, not at process start, so misconfigured networks do not block boot.

## Configuring LDAP / Active Directory

Set `SKILLFORGE_LDAP` to a JSON array of provider objects. Each needs `id` (kebab-case, unique across all login providers including OIDC), `label`, `url` (`ldap://` or `ldaps://`), `bind_dn`, `bind_password`, `user_base`, and `user_filter` containing the `{username}` placeholder. Optional fields: `username_attribute` (default `uid`), `display_name_attribute`, `email_attribute`, `group_attribute` (default `memberOf`), `role_map`, `default_role` (default `viewer`), `timeout_ms` (default 5000), and `tls_ca_file` for verifying `ldaps://` servers against a private CA (certificate verification is never disabled). The service password and server URL never appear in `GET /api/v1/auth/providers` or API responses.

## Search filter and empty passwords

The `{username}` value is escaped per RFC 4515 before substitution so characters like `*`, `(`, `)`, and `\` cannot alter the filter. Empty username or password is rejected with `401 invalid_credentials` before any network call to LDAP—many directories accept an “unauthenticated bind” with a DN and empty password, so the client must refuse that path. User bind uses only the DN returned by the service-account search; zero or multiple matches yield the same uniform `invalid_credentials` response.

## Roles from groups

When `role_map` is set, SkillForge maps LDAP group DNs (case-insensitive) from `group_attribute` (and OIDC claim values from `role_claim`) to SkillForge roles. If several groups match, the **highest** role wins (`admin` > `reviewer` > `contributor` > `viewer`). On every successful login the role is refreshed from the map so the directory remains the source of truth. If nothing matches, `default_role` applies.

## User provisioning

The first successful login for a provider identity creates a SkillForge user. For OIDC the subject is the token `sub`; for LDAP it is `ldap:<id>` plus the entry DN (lowercased). The username comes from `preferred_username` / email local-part (OIDC) or `username_attribute` (LDAP), sanitized to `[a-z0-9-]` (max 32). Collisions append `-2`, `-3`, and so on—so a directory user named `admin` becomes `admin-2` without taking the built-in admin role. No SkillForge password is stored for SSO or LDAP accounts.

> [!NOTE]
> Matching an existing password account by email or username does not link accounts.

## Errors and availability

Wrong password, unknown user, and empty password all return the same `401 invalid_credentials`. A disabled SkillForge account returns `403 account_disabled`. If the LDAP server is unreachable or the service account is rejected, the API returns `503 ldap_unavailable` within about `timeout_ms` (plus a small margin). Unknown provider ids return `404`.

## Local single-user mode

`SKILLFORGE_AUTH_MODE=local` is allowed only when `SKILLFORGE_HOST` is `127.0.0.1`, `::1`, or `localhost`. Password login returns `409 local_mode`. OIDC and LDAP providers are not loaded in local mode. Bearer API tokens still work when presented.

> [!WARNING]
> Unauthenticated requests run as the built-in `local` admin user.

## Security notes

OIDC login state and nonce are random, stored server-side for ten minutes, and bound to the HttpOnly `sf_oidc` cookie. ID tokens must be RS256 or ES256. Client secrets and LDAP bind passwords never appear in provider listings or server logs.