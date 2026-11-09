---
title: Create API token
summary: Creates a personal API token and shows its secret only once. Use it for CLI and CI automation, and store the secret in a vault right away.
related: pages/tokens
---

## What it does

POST /api/v1/me/tokens with a display name; shows the sf_<8>_<32> secret once; stores only sha256 server-side.

## When to use

Use for CI and CLI publish automation.

## Requires

Requires sign-in (any role manages their own tokens).

> [!WARNING]
> The secret is shown only once: copy it into a vault immediately because it cannot be retrieved later.
