---
title: Purge an artifact
summary: Irreversibly removes every version and the card content of an artifact, keeping only its reserved name for audit. Use it only after a leak, when no version may remain.
related: getting-started/purge, pages/artifact
---

## What it does

> [!CAUTION]
> Irreversibly removes all versions and card content. Its name remains reserved for audit and cannot be republished. Earlier backups may retain the leaked content.

## When to use

First revoke the exposed secret. Use this only when every version must be removed. Review shared blobs and backups afterward. Never put the secret itself in the reason.

## Requires

Administrator access, a reason of at least ten characters, and exact typed confirmation of type/name. The server checks all requirements again.
