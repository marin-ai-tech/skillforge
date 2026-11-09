---
title: Manage API tokens from workspace
summary: Opens the API tokens page from the tokens summary on My workspace. Use it to create a token, revoke a leaked one, or check when tokens were last used.
related: pages/me, pages/tokens, actions/tokens/create
---

## What it does

Follows the workspace tokens summary link (`me-tokens-manage`) to `/me/tokens` where you create and revoke personal Bearer tokens for CLI and automation.

## When to use

Use when the overview shows active or never-used counts and you need to mint a secret, revoke a leaked token, or confirm last-used times on the dedicated tokens page.

## Requires

Requires sign-in as any role managing only your own tokens. The overview itself never shows the token secret, name, prefix, or hash.
