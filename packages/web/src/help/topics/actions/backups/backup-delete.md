---
title: Delete backup
summary: Deletes one backup archive from the server after confirmation; the live database is untouched. Use it to free disk space once the archive is copied elsewhere.
related: pages/admin-backups, getting-started/self-hosting
---

## What it does

Opens a confirmation dialog, then calls `DELETE /api/v1/admin/backups/<name>`. On HTTP 204 the table row disappears. Only the archive file under `<data_dir>/backups` is removed; the live database is untouched.

## When to use

Use to free disk after you have copied an archive elsewhere, or to remove a failed/unneeded snapshot. Retention may also delete older files automatically after new creates.

## Requires

Requires sign-in as admin and confirming the dialog. Missing names return 404.

> [!CAUTION]
> Deletion is permanent: SkillForge cannot restore the archive afterwards. Download it or copy it elsewhere first if you may still need it.
