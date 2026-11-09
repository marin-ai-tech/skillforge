---
title: Self-hosting, upgrades and backups
summary: How to run SkillForge in production with Docker, configure it, upgrade it, and take and restore backups.
section: operations
learn:
  - How to deploy with Docker and compose
  - Which environment variables matter
  - How to upgrade without losing data
  - How to create and restore a backup
related: getting-started/plugins, pages/admin-backups, getting-started/overview, getting-started/roles
---

SkillForge is designed to run as a single Node process with SQLite and content-addressed blobs under one data directory. Each release ships as an archive for Windows and Linux (`skillforge-<version>.zip` / `.tar.gz`: unpack and run `start.cmd`, `start.ps1` or `sh start.sh`; Node.js 24 or newer; settings in `skillforge.env`) and as a Windows installer `skillforge-setup-<version>.exe` with Node.js inside: it asks for the port and listen address, puts the program in `%ProgramFiles%\SkillForge`, the data and settings in `%ProgramData%\SkillForge`, and registers the scheduled task "SkillForge" that starts the registry at system startup. `INSTALL.md` in the archive has the details. To build from source, the recommended production path is Docker: a multi-stage `Dockerfile` builds the workspaces, the runtime image installs production dependencies only (`npm ci --omit=dev`), runs as user `node`, exposes port `8787`, mounts `/data`, and health-checks `GET /api/v1/health`. `docker compose up` wires the `skillforge` service, an `env_file`, a named volume for `/data`, and `restart: unless-stopped`.

> [!IMPORTANT]
> Copy `.env.example` to `.env` and set at least `SKILLFORGE_BASE_URL` behind a reverse proxy so session cookies get the correct `Secure` flag.

Environment variables all use the `SKILLFORGE_*` prefix: listen host/port, `SKILLFORGE_DATA_DIR`, public URL, SPA web dir, admin bootstrap password, public-read toggles, session and aging TTLs, import knobs, marketplace identity and `SKILLFORGE_MARKETPLACE_SOURCE` (`auto` by default: an `archive` zip source for an HTTPS base URL, otherwise a `command` source that needs the `skillforge` CLI on the client — see [Installing into your agent](getting-started/install)), `SKILLFORGE_PLUGINS_DIR` (where server plugins live), `SKILLFORGE_REVIEWERS_FILE` (the review-assistant reviewers JSON), and `SKILLFORGE_BACKUP_KEEP` (integer ≥ 1, default 10). Invalid values abort startup with a configuration error that names the variable. On first boot with an empty database the server seeds `admin`; if `SKILLFORGE_ADMIN_PASSWORD` is unset it generates a password and writes it only to `initial-admin-password.txt`, printing just the file's path, under the data directory.

Upgrades are volume-preserving: take a backup, rebuild or pull a new image, restart compose, and let SQL migrations apply on startup. Health should report `db: "ok"`. Backups are consistent snapshots built with SQLite `VACUUM INTO`, then packed with every `blobs/**` object, the signing key `signing/ed25519.pem`, the `plugins/**` files when the plugins directory is inside the data directory, and a `manifest.json` (`format: 1`, counts, server version, migration count, `signing_key_id`) into `skillforge-<YYYYMMDD>T<HHMMSS>Z.tar.gz`. Archives exclude the live `backups/` folder, WAL/SHM sidecars, and the initial admin password file. Create them from the Backups UI, `POST /api/v1/admin/backups`, or curl with an admin session; only one create runs at a time (`409 backup_in_progress`). Retention deletes the oldest files beyond `SKILLFORGE_BACKUP_KEEP`.

Restore offline: stop the server, unpack with `tar -xzf <archive> -C <empty-data-dir>`, point `SKILLFORGE_DATA_DIR` at that directory, and start again. Verify health, admin login, artifact list, that bundle downloads still work, and that `GET /api/v1/install-info` reports the same `signing.key_id` as `manifest.json`: then CLIs keep trusting the registry. A plugins directory outside the data directory (`SKILLFORGE_PLUGINS_DIR`) is not in the archive; back it up yourself. Because backups themselves are not nested inside the archive, a freshly restored instance starts with an empty backups list until you create new ones.

Every stored file is checked against its hash when it is read. A damaged copy answers `500` with `blob_corrupt` and a `request_id`, the server log names the file hash, and the CLI stops without installing anything. Publishing a new version that contains the same file repairs the stored copy (an identical republish is refused as `digest_exists` before anything is written); otherwise restore the file from a backup.

> [!WARNING]
> Prefer storing downloaded archives off-box so a host failure does not take your only copy with it.