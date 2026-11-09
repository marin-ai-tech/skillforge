---
title: Create backup
summary: Creates a new registry backup archive with the database, blobs, and a manifest. Use it before upgrades, risky imports, or any change you may need to roll back.
related: pages/admin-backups, getting-started/self-hosting
---

## What it does

Starts `POST /api/v1/admin/backups`, which snapshots the database with `VACUUM INTO`, packs blobs and `manifest.json` into a new `skillforge-…Z.tar.gz`, and refreshes the backups table. The button stays disabled while the request runs; success shows an admin notice with the filename.

## When to use

Use before upgrades, risky imports, or any change you may need to roll back. Prefer creating a backup from this control rather than copying live SQLite files while the server is running.

## Requires

Requires sign-in as admin. Concurrent creates return `backup_in_progress`.
