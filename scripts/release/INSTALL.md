# Installing SkillForge

This archive holds a complete SkillForge registry: the server, the web interface, runtime dependencies, start scripts
and the CLI package. These instructions cover the archive, the Windows installer, the CLI, the main settings and
backups.

**Requirements:** Node.js 24 or newer (for the archive). The Windows installer bundles Node.js.

## Archive (Windows and Linux)

1. Unpack `skillforge-<version>.zip` (or `.tar.gz`) into any folder. It unpacks into `skillforge-<version>/`.
2. In that folder run `start.cmd` (Windows, or `start.ps1` in PowerShell) or `sh start.sh` (Linux).
   The script checks the Node.js version. On the first start it creates `skillforge.env` next to it, a copy of
   `skillforge.env.example`, and then starts the server with those settings.
3. Open `http://127.0.0.1:8080`. The first admin password is in `data/initial-admin-password.txt` (or set
   `SKILLFORGE_ADMIN_PASSWORD` in `skillforge.env` before the first start). Sign in as `admin`.

Settings live in `skillforge.env` (port, listen address, data folder, public address); one `NAME=value` per line.
By default the registry listens on port 8080 on this machine only (`SKILLFORGE_HOST=127.0.0.1`); set
`SKILLFORGE_HOST=0.0.0.0` to accept connections from the network, and `SKILLFORGE_BASE_URL` to the public address when
the registry sits behind a proxy or a DNS name.

To update, unpack the new version into a new folder and move `skillforge.env` and the data folder there (or point
`SKILLFORGE_DATA_DIR` to the old path). The server applies database migrations on start.

## Windows installer

`skillforge-setup-<version>.exe` asks for the port and the listen address, installs the program into
`%ProgramFiles%\SkillForge` and the data into `%ProgramData%\SkillForge`, and registers the scheduled task
"SkillForge" that starts the registry at system startup. Settings are in `%ProgramData%\SkillForge\skillforge.env`;
the first admin password is in `%ProgramData%\SkillForge\data\initial-admin-password.txt`. An update keeps the settings
and the data.

- Silent install: `skillforge-setup-<version>.exe /S` (port 8080, this machine only).
- Only unpack the files: `skillforge-setup-<version>.exe /EXTRACT=<folder>`.
- Uninstall: `powershell -ExecutionPolicy Bypass -File "%ProgramFiles%\SkillForge\uninstall.ps1"` (data is kept;
  `-RemoveData` deletes it too).

## CLI

The registry serves its own CLI:

```
npm i -g http://<registry-address>/downloads/skillforge-cli.tgz
```

The home page of the registry shows this command. The file is also in the archive's `downloads/` folder.

## More settings

The in-app help of the running registry describes the main settings, upgrades and backups:
`http://<registry-address>/help/getting-started/self-hosting`. The full table of every `SKILLFORGE_*` variable is in
`docs/en/03-self-hosting.md` of the SkillForge repository (the archive does not include it).

## GitHub: rollout through pull requests and rules from reviews

The admin pages `/admin/rollout` (open a pull request with artifacts in chosen repositories) and `/admin/harvest`
(collect recurring rules from review comments) need a GitHub token in `skillforge.env`:

```
SKILLFORGE_GITHUB_TOKEN=<token>
# GitHub Enterprise only:
# SKILLFORGE_GITHUB_API_URL=https://<host>/api/v3
```

The token is read from the environment only and is never stored or shown; give it the narrowest rights that allow
creating branches, files and pull requests. Without it these pages answer `github_not_configured`.

## LLM: help assistant and skill validation

An admin connects the model (an OpenAI-compatible API: OpenAI, OpenRouter, a local Ollama or vLLM) on
`/admin/assistant`: API address, model, limits, and switches for the help assistant and for skill validation by the
model. The API key goes only into `skillforge.env` and is sent only to the listed origins:

```
SKILLFORGE_LLM_API_KEY=<key>
SKILLFORGE_LLM_KEY_ORIGINS=https://api.openai.com
```

Without `SKILLFORGE_LLM_KEY_ORIGINS` the key is never sent. Local servers need no key. Restart the registry after
changing these variables.

## Backups

An admin makes backups on `/admin/backups`; the files are in `<data folder>/backups/`. A backup holds the database, the
artifact files, the version signing key `signing/ed25519.pem` and the plugins from `plugins/` (when the plugins folder
is inside the data folder). Keep a backup as a secret: it holds the private key.

Backups made by version 0.4.0 and earlier do not contain the key. Keep a separate copy of
`<data folder>/signing/ed25519.pem` next to them; otherwise, after a restore the CLI refuses installs
("signing key changed") until people sign in again.

To restore, stop the registry, unpack the backup into an empty data folder and start the registry again:

```
tar -xzf <backup>.tar.gz -C <data folder>
```

## Docker (experimental)

The `docker/` folder holds a `Dockerfile` and `docker-compose.yml` that build an image from the unpacked archive. Run
them from the archive root:

```
docker build -f docker/Dockerfile -t skillforge:<version> .
docker compose -f docker/docker-compose.yml up -d
```

They are not verified.
