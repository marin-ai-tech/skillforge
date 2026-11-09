# Backups and operations

This page is for the admins and operators who keep a SkillForge server running. It covers backups and
restore, the release signing key, health checks, `skillforge doctor` and the diagnostics bundle, server
logs, damaged files, and the settings that connect a language model for the help assistant and skill checks.
For installation and the full list of environment variables, see [Self-hosting](03-self-hosting.md).

## Where the data lives

SkillForge runs as a single Node process. Everything it keeps is under one data directory
(`SKILLFORGE_DATA_DIR`, `/data` in the Docker image):

| Path | Content |
|---|---|
| `skillforge.db` | the SQLite database: artifacts, versions, users, audit and settings |
| `blobs/` | every stored file, content-addressed by hash |
| `signing/ed25519.pem` | the private key that signs published versions, created on first start |
| `plugins/` | server plugins, unless `SKILLFORGE_PLUGINS_DIR` points elsewhere |
| `logs/` | the server log |
| `backups/` | backup archives |

## Backups

### Creating a backup

Open **Backups** in the user menu (`/admin/backups`, admins only) and choose **Create backup**, or call the
API with an admin session or token:

```bash
curl -X POST -H "Authorization: Bearer <admin-token>" <server>/api/v1/admin/backups
```

Each backup is a file `skillforge-<YYYYMMDD>T<HHMMSS>Z.tar.gz` in `<data_dir>/backups`. It contains:

- a consistent snapshot of the SQLite database, made with `VACUUM INTO` while the server keeps running;
- every blob under `blobs/`;
- the signing key `signing/ed25519.pem`;
- the files under `plugins/`, when the plugins directory is inside the data directory;
- `manifest.json` with the format, counts, server version, migration count and `signing_key_id`.

It leaves out the `backups/` folder itself, database WAL and SHM files and the initial admin password file.
Only one backup runs at a time; a second request gets `409 backup_in_progress`. Creating a backup does not
change live data.

### Downloading, deleting and retention

Each row of the backups table has a download link (`GET /api/v1/admin/backups/<name>`) and a delete control
with a confirmation. Deleting removes only the archive file, never the live database, and cannot be undone.

Retention keeps the newest `SKILLFORGE_BACKUP_KEEP` archives (an integer of at least 1, default 10) and deletes
older ones after each new backup. Download every archive you need to keep and store it off the server host,
so a host failure does not take your only copy with it.

> **The archive holds the private signing key.** Anyone who has it can sign versions as this registry. The
> server writes archives readable by its own user only; treat downloaded copies as secrets.

### When to back up

Before every upgrade, before migrations or risky imports, and before purging content. Upgrades keep the data
volume: take a backup, install or pull the new release, restart, and let the database migrations apply on
startup. Health should then report `db: "ok"`.

### Restoring

Restore offline, into an empty directory:

```bash
# 1. stop the server
# 2. unpack the archive into an empty data directory
tar -xzf skillforge-20261109T120000Z.tar.gz -C /srv/skillforge-restored
# 3. point SKILLFORGE_DATA_DIR at that directory and start the server
```

Then verify:

1. `GET /api/v1/health` answers with `db: "ok"`.
2. An admin can sign in and the artifact list is complete.
3. Bundle downloads and installs still work.
4. `GET /api/v1/install-info` reports the same `signing.key_id` as `manifest.json` in the archive.

The last check matters to every CLI user. `skillforge login` remembers the registry's signing key, and
`install` and `sync` check every version against it. Archives made before the key was included do not hold
it; restoring one creates a new key, and every CLI that signed in before stops with `signing key changed`
until people run `skillforge login` again.

A plugins directory outside the data directory is not in the archive; back it up yourself. A restored
instance starts with an empty backups list, because archives are not nested inside archives.

## Damaged files

Every stored file is checked against its hash when it is read. A damaged copy answers `500` with
`blob_corrupt` and a `request_id`, the server log names the file's hash, and the CLI stops without installing
anything. Publishing a new version that contains the same file repairs the stored copy (an identical
republish is refused as `digest_exists` before anything is written); otherwise restore the file from a
backup.

## Health

`GET /api/v1/health` needs no sign-in and is what the Docker health check calls. It returns `status`,
`version`, `commit`, `uptime_s`, `db`, `artifacts`, `plugins` (`loaded`, `errors`, `disabled`) and
`orchestration_enabled`. The absolute data directory (`data_dir`) is added only for an admin signed in with a
session or an admin API token, never for an MCP token.

```bash
skillforge health                          # default http://127.0.0.1:8787, or --url / SKILLFORGE_URL
skillforge health --url https://skills.example.com
```

The command prints the health JSON and exits with 0, or 1 when the server is unreachable or not healthy.

## `skillforge doctor`

`skillforge doctor` prints a checklist of the client side and the connection:

| Check | What it looks at |
|---|---|
| `cli_config` | the CLI config file and its default registry |
| `registry_url` | a registry URL from flags, `SKILLFORGE_URL` or `skillforge login` |
| `credentials` | whether a token is configured (never printed); a warning only |
| `server_health` | `GET /api/v1/health` on that registry, with a 5-second timeout |
| `node_runtime` | the Node.js version against the project's `engines.node`, if any |

```bash
skillforge doctor
skillforge doctor --json        # { ok, checks, status, summary }
```

The overall status is `ok`, `degraded`, `unreachable` or `missing_config`. The exit code is 0 when every check
passes, 3 when no registry is configured or the server is unreachable, and 1 for other failed checks.

### Diagnostics bundle

An admin can download a diagnostics archive to attach to a support request:

```bash
skillforge doctor --bundle
skillforge doctor --bundle --output ./skillforge-diagnostics.tar.gz
```

Without `--output`, the file is `skillforge-diagnostics-<timestamp>.tar.gz` in the current directory. The
archive comes from `GET /api/v1/admin/diagnostics/bundle` and holds only an allowlist:

- `manifest.json`, `health.json` and `plugins.json`;
- `config.json` — the server settings with every password and client secret replaced by `[REDACTED]`;
- up to three of the newest log files, at most the last 512 KiB of each, with secrets masked.

It never contains the database, tokens, password material, `secrets.json`, `.env` files or the initial
admin password file. Other roles get `403` (exit code 4).

## Logs

The server writes JSON lines to `<data_dir>/logs/skillforge.log`. The file rotates at 10 MiB and five rotated
files are kept (`skillforge.log.1` is the newest). Set the level with `SKILLFORGE_LOG_LEVEL`: `error`, `warn`,
`info` (default) or `debug`.

Secrets are masked before anything is written: Bearer tokens, credentials in URLs, values of keys such as
`password`, `token`, `secret` or `api_key`, and the configured secret values themselves.

Every response carries an `x-request-id` header. When a request fails with `500`, the body includes the same
`request_id`; search the log for it. In production mode (`NODE_ENV=production` or
`SKILLFORGE_SAFE_ERRORS=true`) a `500` response hides internal details and returns only `internal_error` and
the request id.

## Connecting a language model

SkillForge can use any OpenAI-compatible chat API — a hosted provider such as OpenAI or OpenRouter, or a local
server such as Ollama or vLLM — for two things: the read-only **help assistant** in the Help center, and
optional **skill checks** by the `review-assistant` plugin. Both are off until an admin sets them up on
**Assistant and LLM** (`/admin/assistant`).

### The API key stays in the environment

The key is not a setting on the page. The server operator sets it in `SKILLFORGE_LLM_API_KEY`; the server
reads it at startup, never stores it in the database, never returns it from the API and masks it in logs.
The key is sent only when the origin (scheme, host and port) of the saved API address is listed in
`SKILLFORGE_LLM_KEY_ORIGINS`. An application admin edits the address, while the key belongs to whoever runs
the host; without the list, an admin could point the address at their own server and receive the key. With an
empty list the key is never sent. Local servers need no key.

Never put a key into the address, the model name or any other field: those are stored in the database and
visible to every admin. If that happens, revoke the key at the provider.

### Settings

| Setting | Range | Default |
|---|---|---|
| Turn the assistant on | on or off | off |
| API address | `http:` or `https:`, no user name or password; `/chat/completions` is called under it | — |
| Model | the provider's model name | — |
| Temperature | 0–2 | 0.2 |
| Longest answer, tokens | 64–8192 | 1024 |
| Timeout, seconds | 5–300 | 60 |
| Requests per user per day | 0 (no limit) – 100000 | 50 |
| Help topics in the context | 1–12 | 6 |

**Skill checks** have their own switch and limits: checks per day (default 200, 0 for no limit), the longest
check answer (256–8192 tokens, default 2048) and a check timeout (5–300 seconds, default 120). When they are
on, the full text of every published skill goes to the provider, including skills visible to one team only;
use a local model for sensitive content. The first time a connection is set up, checks turn on by themselves;
a connection set up before checks existed stays off until an admin turns them on. **Check published skills**
queues older skills within today's budget. Checks need the `review-assistant` plugin to be loaded (see
[Server plugins](14-plugins.md)).

### Connecting step by step

1. Hosted provider: ask the operator to set `SKILLFORGE_LLM_API_KEY`, add the provider's origin (such as
   `https://api.openai.com`) to `SKILLFORGE_LLM_KEY_ORIGINS` and restart the server.
2. Enter the API address (for example `https://api.openai.com/v1`, or `http://localhost:11434/v1` for a local
   Ollama) and the model, and choose **Save**. The API key block shows whether the key is set and sent to this
   address.
3. Choose **Test connection**. It sends a short request with the saved settings and shows the model and the
   delay, or why it failed.
4. Select **Turn the assistant on** and save. The Assistant tab appears in the Help center for every
   signed-in user.
5. After a few days, read **Usage** (today and the last 30 days, in UTC: requests, users, tokens in and out)
   and adjust the daily limit and the number of help topics.

Conversations with the assistant are not stored on the server; only daily counters per user are. Each
settings change is written to the server log with the admin's name and the changed fields, never the key.
The settings are also available as `GET` and `PUT /api/v1/admin/llm`, and the test as
`POST /api/v1/admin/llm/test`.

## See also

- [Self-hosting](03-self-hosting.md) — releases, Docker, environment variables and upgrades.
- [Metadata and purge](19-metadata-and-purge.md) — removing leaked content and blob garbage collection.
- [Admin handbook](handbook/admin.md) — the admin's daily tasks.
- In-app help: `pages/admin-backups`, `getting-started/self-hosting`, `pages/admin-assistant`,
  `getting-started/assistant`, `getting-started/cli`.
