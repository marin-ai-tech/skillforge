# Self-hosting

This page is for the operator who runs a SkillForge registry: how to install a release or a Docker image, every
environment variable the server reads, upgrades, backups and restore, the help assistant, and the first things to
check when something breaks. For a tour of the moving parts see [Architecture](04-architecture.md); for day-to-day
operations see [Backups and operations](20-backups-and-operations.md). In-app help: `getting-started/self-hosting`.

SkillForge is one Node.js process with an SQLite database and content-addressed files under one data directory.
There are three ways to run it: the release archive (Windows and Linux), the Windows installer, or a Docker image
built from source.

## Release files

A release consists of these files:

| File | What it is |
|---|---|
| `skillforge-<version>.zip`, `.tar.gz` | Server, web interface, runtime dependencies and start scripts; the same content for Windows and Linux; needs Node.js 24 or newer |
| `skillforge-cli-<version>.tgz` | The CLI as one file without dependencies; also in the archive's `downloads/` folder, from where the registry serves it |
| `skillforge-setup-<version>.exe` | Windows installer (NSIS) with Node.js bundled |
| `SHA256SUMS.txt`, `RELEASE-NOTES.md` | Checksums of every file and the list of changes |

To build a release from source, run `npm run release` (`scripts/release.mjs`); the files land in `dist/release/`.
Flags: `--out <folder>`, `--skip-build` (reuse the existing `dist` folders), `--no-installer`. The installer needs
`makensis` and a Windows `node.exe` pointed to by `SKILLFORGE_NODE_WIN_EXE`. The commit a build was made from is shown
in `GET /api/v1/health` (`commit`) and in `RELEASE-NOTES.md`.

### Archive

Unpack the archive and run `start.cmd` or `start.ps1` (Windows) or `sh start.sh` (Linux). The script checks for
Node.js 24 or newer, creates `skillforge.env` from `skillforge.env.example` on the first start and starts the server
with those settings (port 8080 by default, this machine only). `INSTALL.md` inside the archive has the details.

### Windows installer

The installer asks for the port and the listen address. The program goes to `%ProgramFiles%\SkillForge\<version>`
with a `current` link to the active version; the data and `skillforge.env` go to `%ProgramData%\SkillForge`, and an
update never touches them. The scheduled task "SkillForge" starts the registry as SYSTEM at system startup.

```bash
skillforge-setup-<version>.exe /S                 # silent: port 8080, this machine only
skillforge-setup-<version>.exe /EXTRACT=<folder>  # only unpack the files
```

To uninstall, run `uninstall.ps1` in the program folder. The data stays; `-RemoveData` deletes it too.

### CLI served by the registry

When `skillforge-cli.tgz` is in `SKILLFORGE_DOWNLOADS_DIR` (`downloads/` in a release), the registry serves it at
`/downloads/skillforge-cli.tgz` without sign-in (the package holds no registry data). `GET /api/v1/install-info` then
returns `cli: { version, url }`, and the home page shows the command `npm i -g <url>`. Only `skillforge-cli.tgz` and
`skillforge-cli-<version>.tgz` are served; any other name answers 404.

The release also carries `docker/Dockerfile` and `docker/docker-compose.yml`, which build an image from the unpacked
archive. They are experimental and not verified; prefer the image built from source below.

## Prebuilt image

Every release publishes the image `ghcr.io/marin-ai-tech/skillforge:<version>` and moves `:latest` to it. It is the
same image the `Dockerfile` of the repository builds.

```bash
docker run -d --name skillforge -p 8787:8787 -v skillforge-data:/data ghcr.io/marin-ai-tech/skillforge:latest
docker exec skillforge cat /data/initial-admin-password.txt
```

Pass settings with `-e NAME=value` or `--env-file skillforge.env` (see [Environment variables](#environment-variables)).
To upgrade, pull the new tag and start a new container with the same volume; migrations run on start. Pin a version
tag in production rather than `latest`.

## Quick start with Docker Compose

1. Copy `.env.example` to `.env` and set `SKILLFORGE_ADMIN_PASSWORD` and `SKILLFORGE_BASE_URL` if needed.
2. Build and start the service:

```bash
docker compose up -d --build
```

3. Open `http://localhost:8787`. Health: `GET /api/v1/health`.
4. Sign in as `admin`. If `SKILLFORGE_ADMIN_PASSWORD` is not set, the server generates a password and writes it only
   to `<data_dir>/initial-admin-password.txt` (the log shows only the path; in the container it is usually
   `/data/initial-admin-password.txt`). The file is deleted after the first admin password change.

```bash
docker compose exec skillforge cat /data/initial-admin-password.txt
```

The Docker volume is mounted at `/data` (`SKILLFORGE_DATA_DIR=/data`); it holds `skillforge.db`, `blobs/`, `backups/`
and service files.

## Image and ports

- The `Dockerfile` is multi-stage on `node:24-alpine`; the runtime image has no dev dependencies and runs as user `node`.
- Port `8787` (`EXPOSE`, publish `8787:8787`).
- `HEALTHCHECK` calls `http://127.0.0.1:8787/api/v1/health`.
- Container defaults: `SKILLFORGE_HOST=0.0.0.0`, `SKILLFORGE_DATA_DIR=/data`.

```bash
docker build -t skillforge .
docker run --rm -p 8787:8787 -v skillforge-data:/data --env-file .env skillforge
```

## Environment variables

Boolean variables accept only `true`/`1` and `false`/`0`; an empty value means the default. Any other value (`yes`,
`TRUE`, `on`) stops the start with `Invalid configuration: <VAR>`. An invalid value of any variable below is a
configuration error that names the variable, and the process does not start.

| Variable | Default | Description |
|---|---|---|
| `SKILLFORGE_PORT` | `8787` | HTTP port (integer > 0) |
| `SKILLFORGE_HOST` | `127.0.0.1` | Bind address; `0.0.0.0` in Docker |
| `SKILLFORGE_DATA_DIR` | `./data` | Data directory (SQLite, blobs, backups) |
| `SKILLFORGE_BASE_URL` | `http://<host>:<port>` | Public URL (the session cookie is `Secure` for https) |
| `SKILLFORGE_WEB_DIR` | `packages/web/dist` | Folder of the built web app |
| `SKILLFORGE_DOWNLOADS_DIR` | `downloads` (install root) | Where the registry serves `skillforge-cli*.tgz` from at `/downloads/…` |
| `SKILLFORGE_ADMIN_PASSWORD` | (generated) | Admin password for an empty database |
| `SKILLFORGE_PUBLIC_READ` | `true` | Anonymous GET of the catalog |
| `SKILLFORGE_SESSION_TTL_DAYS` | `30` | Session lifetime in days (1–365) |
| `SKILLFORGE_AGING_DAYS` | `90` | Days before active → aging |
| `SKILLFORGE_CANDIDATE_TTL_DAYS` | `30` | Candidate lifetime in days (≥ 0) |
| `SKILLFORGE_DATA_LIFECYCLE` | `on` | Data-based lifecycle rules: `on`/`off` |
| `SKILLFORGE_ZOMBIE_IDLE_DAYS` | `180` | Days idle before aging → zombie |
| `SKILLFORGE_ZOMBIE_WINDOW_DAYS` | `60` | Usage window in days for `low_transfer` |
| `SKILLFORGE_ZOMBIE_MIN_USES` | `20` | Minimum capped uses for `low_transfer` |
| `SKILLFORGE_ZOMBIE_MIN_REPORTERS` | `3` | Minimum distinct reporters for `low_transfer` |
| `SKILLFORGE_ZOMBIE_TRANSFER_RATE` | `0.2` | Transfer-rate threshold (0..1) |
| `SKILLFORGE_ZOMBIE_RETIRE_DAYS` | `30` | Days in zombie before cleanup suggests retire |
| `SKILLFORGE_ABLATION_MIN_TASKS` | `10` | Minimum ablation tasks for `no_ablation_uplift` |
| `SKILLFORGE_EVAL_RUNNERS_FILE` | (empty) | Path to the JSON file of skill-eval runners (read on each run) |
| `SKILLFORGE_EVAL_CONCURRENCY` | `2` | Parallel case executions in one eval run (1..8) |
| `SKILLFORGE_EVAL_MAX_RUNS_PER_DAY` | `20` | Maximum eval runs per artifact per UTC day (≥ 1) |
| `SKILLFORGE_EVAL_ABLATION_AUTO` | `false` | Schedule an ablation eval batch for each published skill version |
| `SKILLFORGE_REVIVE_WINDOW_DAYS` | `14` | Window for aging → active revive |
| `SKILLFORGE_REVIVE_MIN_EVENTS` | `3` | Minimum usage events to revive |
| `SKILLFORGE_LIFECYCLE_MAX_PER_SWEEP` | `20` | Maximum automatic transitions per sweep |
| `SKILLFORGE_IMPORT_GIT` | `true` | Allow git import |
| `SKILLFORGE_IMPORT_ALLOW_FILE_URLS` | `false` | Allow `file://` git URLs |
| `SKILLFORGE_IMPORT_TTL_MINUTES` | `15` | Import session lifetime in minutes (1–120) |
| `SKILLFORGE_MARKETPLACE_NAME` | `skillforge` | Marketplace name (kebab-case) |
| `SKILLFORGE_MARKETPLACE_OWNER` | `SkillForge` | Marketplace owner |
| `SKILLFORGE_MARKETPLACE_SOURCE` | `auto` | How `marketplace.json` points Claude Code (≥ 2.1.288) at a plugin. `archive`: a zip with `sha256` (needs `https:` and a host that is not `localhost`, loopback or link-local). `command`: `skillforge plugin-dir …` on the client (CLI on `PATH`, consent in an interactive terminal). `auto`: `archive` when `SKILLFORGE_BASE_URL` allows it, otherwise `command`. A value that does not fit the address stops the start. Use `command` if clients do not trust the server certificate |
| `SKILLFORGE_BACKUP_KEEP` | `10` | How many backup archives to keep (integer ≥ 1) |
| `SKILLFORGE_RUN_OUTPUT_RETENTION_DAYS` | `30` | Days to keep run outputs; `0` keeps them forever |
| `SKILLFORGE_RUN_OUTPUT_MAX_BYTES` | `1048576` | Maximum bytes per run output stream; longer output is truncated |
| `SKILLFORGE_ORCHESTRATION_ENABLED` | `false` | Switch for orchestration (workflows, routines and hooks APIs plus the routines scheduler). When off, the routes answer `403 feature_disabled` and the Workflows and Routines tabs are hidden. Operator-only: there is no API toggle. When on, only an admin sets commands, and processes run as the server's OS user without file-system isolation; enable only on trusted installations (see [Orchestration](18-orchestration.md)) |
| `SKILLFORGE_ROUTINES_DISABLED` | `false` | `true`/`1` stops the routines scheduler (manual runs still work); read at startup |
| `SKILLFORGE_HOOKS_DISABLED` | `false` | `true`/`1` stops the hook runtime: evaluations return `allow` without executing or auditing; read at startup |
| `SKILLFORGE_LOG_LEVEL` | `info` | Level of the server log `<data_dir>/logs/skillforge.log`: `error`, `warn`, `info` or `debug`. An unknown value does not stop the start: the server warns on stderr and uses `info` |
| `SKILLFORGE_SAFE_ERRORS` | `false` | `true`/`1`: a 500 answer has no internal error text (`internal_error` + `request_id`); always on with `NODE_ENV=production` |
| `SKILLFORGE_HOOK_TIMEOUT_S` | `10` | Hook entry timeout in seconds when the entry has no own `timeout` (integer 1–600) |
| `SKILLFORGE_PLUGINS_DIR` | `<data_dir>/plugins` | Server plugins folder |
| `SKILLFORGE_MIRROR_INTERVAL_HOURS` | `24` | How often to check mirrors of external catalogs, in hours; `0` turns the background check off |
| `SKILLFORGE_BUNDLED_PLUGINS_DIR` | `packages/server/bundled-plugins` | Folder of the plugins shipped with a release (`review-assistant`); an empty value disables it |
| `SKILLFORGE_PLUGINS_DISABLED` | `false` | Do not load server plugins |
| `SKILLFORGE_REVIEWERS_FILE` | (empty) | Path to the JSON file of `review-assistant` reviewers (read on each run) |
| `SKILLFORGE_AGENT_ROOTS` | (empty) | Folders for admin server agents, separated by `;` or `:` (prefer `;` on Windows). Empty: `403 agent_roots_disabled` |
| `SKILLFORGE_STARTER_PACKS_DIR` | `packages/server/starter-packs` | Folder of vendored starter packs (absolute or relative to the working directory) |
| `SKILLFORGE_AUTH_MODE` | `password` | `password` or `local` (`local` only with a loopback `SKILLFORGE_HOST`) |
| `SKILLFORGE_PUBLIC_URL` | (none) | Public origin for OIDC redirects; required when any OIDC provider is configured |
| `SKILLFORGE_OIDC_PROVIDERS` | (none) | JSON array of OIDC providers (`id` kebab-case, `label`, `issuer`, `client_id`, `client_secret`, optional scopes and role map) |
| `SKILLFORGE_GOOGLE_CLIENT_ID` | (none) | Google OIDC client id (preset provider `google`; set together with the secret) |
| `SKILLFORGE_GOOGLE_CLIENT_SECRET` | (none) | Google OIDC client secret (never logged or returned by the API) |
| `SKILLFORGE_LDAP` | (none) | JSON array of LDAP/AD providers (`id` kebab-case and unique across all sign-in providers, `label`, `url` ldap/ldaps, `bind_dn`, `bind_password`, `user_base`, `user_filter` with `{username}`, optional attributes, role map, timeout, `tls_ca_file`) |
| `SKILLFORGE_LLM_API_KEY` | (empty) | API key of an OpenAI-compatible provider for the help assistant and skill validation by a model. Environment only: not stored in the database, not returned by the API, masked in logs. Local servers (Ollama, vLLM) need none. See [Help assistant](#help-assistant-llm) |
| `SKILLFORGE_LLM_KEY_ORIGINS` | (empty) | Comma-separated origins the key may be sent to, for example `https://api.openai.com, http://localhost:11434`. Empty: the key is sent nowhere. A value that is not `http(s)` or holds a user or password stops the start |
| `SKILLFORGE_GITHUB_TOKEN` | (empty) | GitHub token for rollout through pull requests (`/admin/rollout`) and rules from reviews (`/admin/harvest`). Environment only, sent only to `SKILLFORGE_GITHUB_API_URL`, never shown or stored. Needs rights to create branches, files and pull requests in the chosen repositories. Empty: both answer `503 github_not_configured` |
| `SKILLFORGE_GITHUB_API_URL` | `https://api.github.com` | GitHub REST API; for GitHub Enterprise `https://<host>/api/v3`. `https:` only (`http:` only for `localhost`, `127.0.0.1`, `[::1]`), no user, password or query; otherwise the start stops |

## Reverse proxy and `SKILLFORGE_BASE_URL`

Behind nginx, Caddy or Traefik, proxy to the container's `:8787`. Set `SKILLFORGE_BASE_URL` to the public HTTPS URL:
absolute links and the `Secure` flag of the `sf_session` cookie depend on it. The proxy must pass the original `Host`
and scheme (or correct `X-Forwarded-*` headers, if you handle them on your side).

## Upgrading

1. Make a backup (page, API or `curl`, see below) and keep the `/data` volume.
2. Update the code or image: `docker compose pull` or `docker compose up -d --build`.
3. The server applies SQL migrations at startup; the data volume is kept.
4. Check `GET /api/v1/health` (`db: "ok"`).

Archive: unpack the new version into a new folder, move `skillforge.env` there (the data folder follows
`SKILLFORGE_DATA_DIR`) and start it. Windows installer: run the new `skillforge-setup-<version>.exe`; it stops the task,
installs the version next to the old one, switches `current` and keeps settings and data.

## Backups

The server takes a consistent snapshot with `VACUUM INTO` into a temporary file and packs `skillforge.db`, every file
under `blobs/**`, the version signing key `signing/ed25519.pem`, the files under `plugins/**` (when the plugins folder
is inside the data directory) and `manifest.json` (with `signing_key_id`, the `key_id` of the key in the archive) into
`<data_dir>/backups/skillforge-<YYYYMMDD>T<HHMMSS>Z.tar.gz`. The archive does **not** include `backups/`, the `-wal`
and `-shm` files or `initial-admin-password.txt`. Copy a plugins folder outside the data directory
(`SKILLFORGE_PLUGINS_DIR`) yourself.

**A backup is a secret.** It holds the private signing key, which can sign versions on behalf of the registry. The
server creates the file readable by its owner only (`0600` on POSIX); keep downloaded copies the same way. Backups made
by version 0.4.0 and earlier do not hold the key (their `manifest.json` has no `signing_key_id`): keep a separate copy
of `signing/ed25519.pem` next to them. Otherwise a restore creates a new key, and CLIs refuse installs with
"signing key changed" until people sign in again.

**From the web UI.** The **Backups** page (`/admin/backups`, admin only) creates, downloads and deletes backups (with
confirmation). A hint on the page shows the restore command for the newest backup.

**From the API.**

```bash
curl -sS -X POST -b cookies.txt http://localhost:8787/api/v1/admin/backups                 # create
curl -sS -b cookies.txt http://localhost:8787/api/v1/admin/backups                         # list
curl -sS -b cookies.txt -O http://localhost:8787/api/v1/admin/backups/skillforge-20260101T000000Z.tar.gz
curl -sS -X DELETE -b cookies.txt http://localhost:8787/api/v1/admin/backups/skillforge-20260101T000000Z.tar.gz
```

Only one create runs at a time (`409 backup_in_progress`). After a create, the oldest files beyond
`SKILLFORGE_BACKUP_KEEP` are deleted.

**On a schedule.** Create an admin API token on the **API tokens** page and call the API with
`Authorization: Bearer`. A daily `cron` entry at 03:00 that downloads the copy to the host outside the container:

```bash
0 3 * * * curl -fsS -X POST -H "Authorization: Bearer $SKILLFORGE_TOKEN" http://localhost:8787/api/v1/admin/backups \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).backup.name))" \
  | xargs -I{} curl -fsS -H "Authorization: Bearer $SKILLFORGE_TOKEN" -o /var/backups/skillforge/{} http://localhost:8787/api/v1/admin/backups/{}
```

Keep downloaded archives off the host (object storage, another server): the `/data` volume and its `backups/` folder
are lost together with the machine.

## Restore

1. Stop the server (`docker compose down`).
2. Prepare an **empty** data directory (or a new volume).
3. Unpack the archive into the root of the data directory:

```bash
tar -xzf skillforge-YYYYMMDDTHHMMSSZ.tar.gz -C /path/to/empty-data-dir
```

4. Start the server with `SKILLFORGE_DATA_DIR` pointing at it. Check health, admin sign-in and the catalog, and that
   `GET /api/v1/install-info` reports the same `signing.key_id` as `manifest.json`: then CLIs keep trusting the registry.
5. The archive has no `backups/` folder, so the backup list is empty until you create new ones.

Restore into a named Docker volume (service stopped, archive in the current folder):

```bash
docker compose down
docker volume rm skillforge_skillforge-data      # volume name: <project>_skillforge-data, see `docker volume ls`
docker volume create skillforge_skillforge-data
docker run --rm -v skillforge_skillforge-data:/data -v "$PWD:/restore:ro" alpine \
  sh -c "tar -xzf /restore/skillforge-YYYYMMDDTHHMMSSZ.tar.gz -C /data && chown -R 1000:1000 /data"
docker compose up -d
```

`chown` is needed because the server in the container runs as user `node` (uid 1000); files unpacked by root would not
be writable. `manifest.json` in the archive (`format: 1`) lets you compare `counts`, `server_version` and the number of
migrations before the start.

## Help assistant (LLM)

The assistant in the help center answers signed-in users' questions about the help through an OpenAI-compatible API
(`POST {base_url}/chat/completions`): OpenAI, OpenRouter, a local Ollama or vLLM. It is off by default.

- **Environment:** only `SKILLFORGE_LLM_API_KEY` and `SKILLFORGE_LLM_KEY_ORIGINS`; read at startup, so restart after a change.
- **Web UI:** everything else. An admin opens the user menu → **Assistant** (`/admin/assistant`) and sets the switch,
  API address, model, temperature, answer length limit, timeout, daily request limit per user and the number of help
  topics in the context (stored in the database, table `llm_settings`). The page also shows the key state (set or not,
  allowed for the saved address), a connection test and usage for today and the last 30 days.
- **Help used as context:** `<SKILLFORGE_WEB_DIR>/help-corpus/<language>/`, built with the web app (`npm run build`).

```bash
SKILLFORGE_LLM_API_KEY=sk-...
SKILLFORGE_LLM_KEY_ORIGINS=https://api.openai.com, http://localhost:11434
```

`SKILLFORGE_LLM_KEY_ORIGINS` is a comma-separated list of origins (scheme, host, port; a path is ignored). The key goes
into `Authorization: Bearer` only when the origin of the configured API address is in the list:
`https://api.openai.com/v1` matches `https://api.openai.com`, while `http://localhost:8080/v1` does not match
`http://localhost:11434`. Without the variable the key is sent nowhere, and the admin page warns about it. An item
that is not `http:`/`https:`, does not parse as a URL or holds a user or password stops the start with
`Invalid configuration: SKILLFORGE_LLM_KEY_ORIGINS`. A local server without a key needs no list.

Threat model:

- **Key.** The host operator sets the key, while an application admin can change the API address. Without the origin
  binding an admin could point the address at their own server and capture the key, so the operator lists explicitly
  whom the key may be trusted to. The key never reaches the database, API answers (only "set / not set" and the
  variable name), logs or `doctor --bundle`. Provider errors reach the client only as a code (`llm_unauthorized`,
  `llm_timeout`, `llm_upstream_error`), without the response body.
- **Read only.** A request to the model never carries `tools`/`functions`, `tool_calls` in the answer are ignored, and
  the server executes nothing based on the answer. The answer is rendered as markdown without HTML; links work only
  inside the help (`/help/…`). The context holds only the help and the user's role, no registry data; an injected
  instruction in a question can spoil only the answer text.
- **Conversations.** Message text is not stored on the server or logged; the `llm_usage` table holds only daily (UTC)
  request and token counters per user. The conversation history lives in the browser tab's `sessionStorage`. User
  questions go to the model provider; if that is not acceptable, use a local server.
- **Access and spend.** Signed-in users only (`401` otherwise), MCP tokens get `403`. The daily limit per user is checked
  before the model is called (`429 assistant_daily_limit`), and a conversation is limited to 20 messages of 4000
  characters.

## Troubleshooting `blob_corrupt`

`500 {"error": "blob_corrupt", "request_id": "…"}` when reading a file or a version bundle means the stored copy of a
file (`<data_dir>/blobs/…`) no longer matches its sha256 (disk damage, manual edit). The server serves that file to
nobody; the version's other files still read. The CLI reports
`the registry copy of this file is damaged (blob_corrupt), nothing was installed` and installs nothing. The server log
has a `blob_corrupt` entry with the `request_id`, the `sha` of the damaged file and the request path (no content).

To fix it, publish a new version that contains the same file: the server replaces the damaged copy with the correct
content, and the file reads again in every version. Republishing without changes (same digest) does not help: it is
refused with `digest_exists`. If the source file is gone, restore the data directory from a backup (see
[Restore](#restore)).

## Health

`GET /api/v1/health` is always available without sign-in and returns `status`, `version`, `commit`, `uptime_s`, `db`,
`artifacts`, `plugins` (`loaded`, `errors`, `disabled`) and `orchestration_enabled`. The absolute data directory path
(`data_dir`) is shown only to an admin signed in with a session or an admin API token (not an MCP token); it is also in
the diagnostics bundle. The Docker `HEALTHCHECK` uses this endpoint.

## The review-assistant plugin

The `review-assistant` plugin adds an independent review of artifacts: several external reviewers (different models)
check the prompt against an audit checklist, a judge merges the findings, and a reviewer decides on each one (fix /
check / defer / reject). The result of a run is saved as evidence of the version.

The plugin ships in the zip, tar.gz, installer and Docker image (`packages/server/bundled-plugins`) and loads by itself.
A plugin with the same name in `SKILLFORGE_PLUGINS_DIR` replaces it, an empty `SKILLFORGE_BUNDLED_PLUGINS_DIR` disables
it, and `/admin/plugins` turns it off for this installation.

When an LLM is connected on the assistant page and validation is on, no reviewers file is needed: every skill version is
checked by the model in the background. The skill content goes to the provider, so on an upgrade of an installation
that is already configured, validation stays off until an admin decides.

The reviewers file is JSON, its path is set by `SKILLFORGE_REVIEWERS_FILE`, and the plugin reads it again on every run.
It is an object with a `reviewers` array and an optional `judge`. Each reviewer has `id` (reviewer name), `command`
(an argument array, no shell), an optional `env` and an optional `timeout_s` (default 300):

```json
{
  "reviewers": [
    { "id": "strict", "command": ["claude", "-p", "--output-format", "json"], "env": {} },
    { "id": "lenient", "command": ["codex", "exec", "--sandbox", "read-only"], "env": {} }
  ]
}
```

**Always** run reviewers without tools, so that they cannot read the operator's files, tokens or network: `claude -p`
with an empty tool list and `--output-format json`; `codex exec --sandbox read-only`. The plugin starts processes
directly (no shell), passes an allowlisted environment plus the reviewer's `env`, and kills the whole process tree on
timeout.

More about server plugins: [Plugins](14-plugins.md).
