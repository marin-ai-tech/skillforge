---
title: Backups administration
summary: Backups administration creates, downloads and deletes archives of SkillForge data. Use it before upgrades, migrations or risky imports so you can restore the registry.
section: ui-admin
learn:
  - What a backup archive contains
  - How to create and download a backup
  - How to restore from an archive offline
  - How deletion and retention remove archives
related: getting-started/self-hosting, actions/backups/backup-create, pages/users
---

## What this page is for

Backups administration is the admin-only UI for creating, downloading, and deleting SkillForge data archives. Each backup is a `skillforge-<UTC>.tar.gz` under the server data directory that contains a consistent SQLite snapshot (`VACUUM INTO`), every content-addressed blob, the release signing key `signing/ed25519.pem`, the files under `plugins/` when the plugins directory is inside the data directory, and a `manifest.json` with counts and the `signing_key_id`. Use this page before upgrades, migrations, or risky imports so you can restore the registry into an empty data directory. Only administrators may call the backup APIs; other signed-in roles see a forbidden state, and anonymous visitors are sent to sign-in with `next=/admin/backups`.

## What you see

- A Create backup button (`backup-create`) that stays disabled while a request is in flight.
- A table (`backups-table`) of archives with name, human-readable size, and relative created time (ISO in the title tooltip).
- Per-row download link (`backup-download`) pointing at `GET /api/v1/admin/backups/<name>` and a delete control that opens a confirmation dialog.
- An empty state (`backups-empty`) when no archives exist yet, plus a restore hint showing `tar -xzf` for the newest archive.
- Shared admin notice and error banners for success and API failures (including `backup_in_progress`).

## Common tasks

1. Sign in as admin and open Backups from the user menu (`menu-backups`) or go to `/admin/backups`.
2. Click Create backup; wait for the notice with the new filename and a new table row.
3. Download the archive via the row link and store it outside the server host if needed.
4. Before deleting, confirm the dialog; the row disappears after HTTP 204.
5. To restore offline, stop the server, unpack with `tar -xzf <name> -C <empty-data-dir>`, then start with that data directory.

> [!WARNING]
> An archive holds the private signing key: anyone who has it can sign versions as this registry. The server writes it readable by its owner only; keep downloaded copies as a secret. Archives made before the key was included do not hold it, and a restore from them creates a new key, so every CLI that signed in before refuses installs with "signing key changed" until people sign in again.

> [!CAUTION]
> Deleting an archive is permanent, and retention (`SKILLFORGE_BACKUP_KEEP`) may remove older local archives automatically after new creates. Download any archive you need to keep and store it outside the server host.

## Permissions

Requires role admin. Viewer, contributor, and reviewer receive 403 on backup APIs and see `admin-forbidden` on this page. Anonymous users are redirected to `/login?next=/admin/backups`. Creating backups does not change live data; deletion only removes archive files under `<data_dir>/backups`, never the live database.
