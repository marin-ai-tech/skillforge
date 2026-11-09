---
title: Choose sign-in method
summary: Switches the sign-in form between a SkillForge password and a configured LDAP or Active Directory provider. Use it when you sign in with a corporate directory account.
related: pages/login, getting-started/sso
---

## What it does

Switches the login form between a SkillForge password account and a configured LDAP / Active Directory provider. The same username and password fields are submitted to either `POST /api/v1/auth/login` or `POST /api/v1/auth/ldap/:id/login`.

## When to use

Use when your administrator configured `SKILLFORGE_LDAP` and you sign in with a corporate directory account instead of a local SkillForge password. OIDC buttons remain separate below the form.

## Requires

Requires at least one LDAP provider in `GET /api/v1/auth/providers`. Not shown when only password or OIDC providers are configured. Not available in local single-user mode.