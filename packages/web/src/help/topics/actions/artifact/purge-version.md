---
title: Purge a version
summary: Irreversibly removes one version's content and leaves a dated tombstone. Use it after a secret leaked in that version, once the secret has been revoked.
related: getting-started/purge, pages/artifact
---

## What it does

> [!CAUTION]
> Irreversibly removes a version's content and leaves a dated tombstone. Shared blobs and backups may retain copies. The version cannot be installed again.

## When to use

First revoke the exposed secret. Use purge after a leak and inspect the response for shared blobs and backups. Never put the secret itself in the audit reason.

## Requires

Administrator access, a reason of at least ten characters, and exact typed confirmation including the version. The server checks these requirements again.
