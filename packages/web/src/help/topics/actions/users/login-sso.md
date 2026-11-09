---
title: Sign in with SSO
summary: Signs you in through a configured OpenID Connect provider such as Google. Use it when your administrator set up SSO and you prefer corporate credentials.
related: pages/login, getting-started/sso
---

## What it does

Starts the OpenID Connect Authorization Code + PKCE flow for the configured provider. The browser is redirected to the identity provider and returns to SkillForge with a session cookie after a successful sign-in.

## When to use

Use when your administrator has configured Google or another OIDC provider and you prefer corporate credentials instead of a local SkillForge password. Prefer SSO when your account was created automatically on first IdP login.

## Requires

Requires a configured OIDC provider (`SKILLFORGE_OIDC_PROVIDERS` or Google preset) and a working redirect URI under `SKILLFORGE_PUBLIC_URL`. Not available in local single-user mode.