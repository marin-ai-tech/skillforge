---
title: Revoke API token
summary: Deletes one of your API tokens so that its secret stops working immediately. Use it when a secret leaks or a pipeline is retired.
related: pages/tokens
---

## What it does

Deletes a token id after ConfirmDialog confirmation. Subsequent Authorization: Bearer calls with that secret return 401 unauthorized.

## When to use

Use when a secret leaks or a pipeline is retired.

## Requires

Requires sign-in (own tokens only).

> [!CAUTION]
> Revoking takes effect at once and cannot be undone: every client still using this secret gets 401 until you give it a new token.
