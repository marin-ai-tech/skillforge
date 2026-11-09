---
title: Download backup
summary: Downloads a backup archive to your computer. Use it to keep copies off the server host for recovery.
related: pages/admin-backups, getting-started/self-hosting
---

## What it does

Follows the row link to `GET /api/v1/admin/backups/<name>` and downloads the gzip archive (`content-disposition: attachment`). Store the file outside the server host when you need off-box recovery.

## When to use

Use after creating a backup, before wiping a volume, or when copying archives to cold storage. The href is a plain same-origin `<a>` so the browser handles the download with your session cookie.

## Requires

Requires sign-in as admin. Invalid or unknown names return 404.
