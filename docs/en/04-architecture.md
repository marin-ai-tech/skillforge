# Architecture

This page describes how SkillForge is built: the packages, the domain model, how artifacts are stored and
distributed, and the HTTP API surface. It is for operators who want to know what runs on their host and for
contributors who want to find their way in the code. Installation and configuration are in
[Self-hosting](03-self-hosting.md).

## One process, one data directory

SkillForge runs as a single Node.js process (Node.js 24 or newer) on one port. It serves the REST API, the MCP
endpoint, the marketplace and the web app. All state lives in one data directory (`SKILLFORGE_DATA_DIR`):

| Path in the data directory | Content |
|---|---|
| `skillforge.db` | SQLite database (built-in `node:sqlite`, WAL mode): artifacts, versions, users, audit, settings |
| `blobs/<sha256[0:2]>/<sha256>` | File contents, addressed by their sha256 |
| `signing/ed25519.pem` | The registry's version signing key |
| `plugins/` | Server plugins (default `SKILLFORGE_PLUGINS_DIR`) |
| `backups/` | Backup archives |
| `logs/skillforge.log` | Server log |

There are no native dependencies. Configuration comes only from `SKILLFORGE_*` environment variables
(see [Self-hosting](03-self-hosting.md#environment-variables)).

On start the server, in order: applies the numbered SQL migrations from `packages/server/migrations`, loads (or creates)
the signing key and signs versions that have no signature yet, seeds the `admin` user on an empty database, loads
server plugins, registers the routes and starts listening. Background timers run the lifecycle sweep (hourly), the
mirror check (`SKILLFORGE_MIRROR_INTERVAL_HOURS`) and, when orchestration is on, the routines scheduler.

## Packages

The repository is an npm workspaces monorepo in TypeScript.

| Package | Role |
|---|---|
| `packages/core` | Domain logic without IO: types, parsers and validators of the seven artifact types, bundle digest, normalisation to the canonical bundle, quality checks, agent runtime table and translation, version specs. Used by the server and the CLI |
| `packages/server` | Fastify with zod schemas, `node:sqlite`, the blob store on the file system, the MCP endpoint, the marketplace and the static web app |
| `packages/web` | React, Vite and Tailwind; built into `packages/web/dist` and served by the server at `/`. Includes the in-app help |
| `packages/cli` | The `skillforge` CLI: `login`, `publish`, `install`, `sync`, `outdated`, `agent scan`, `mcp` and more |
| `plugins/review-assistant` | The server plugin shipped with every release (`packages/server/bundled-plugins` in a release) |

```bash
npm ci
npm run build          # TypeScript for all packages, then the web app
npm start              # node packages/server/dist/index.js
```

## Domain model

- **Artifact**: identified by `type` + `name` (kebab-case, at most 64 characters, equal to the folder or file name).
  Carries `description`, `display_name`, `tags`, `labels`, `status` (`candidate`, `active`, `aging`, `zombie`,
  `retired`), `visibility` (`org` or `team`), `owner_team`, `owner`, `maintainers`, `latest_version`,
  `replaced_by`, download count, quality summary and the agents it installs into.
- **Version**: `version` (semver), `digest` (sha256 of the bundle), `channel` (`stable` or `beta`), `files`
  (`path`, `sha256`, `size`), the author's frontmatter as JSON, `changelog`, `model_compat`, declared agents,
  `provenance` (`source`: `human`, `reckon`, `agentspace`, `dreamteam`, `import`, `agent` or `harvest`, plus `ref`),
  `evidence`, ablation results, `validated_at`, `use_count`, `help_count`, `published_by`, `published_at`, the
  quality report and the Ed25519 `signature`. Versions are immutable; the same digest is never published twice for one
  artifact (`digest_exists`).
- **Audit event**: actor, artifact, version, action, from and to, reason and details. Append-only; read at
  `/admin/audit` or per artifact.
- **User, team, API token**: roles `viewer < contributor < reviewer < admin`. Users sign in with a password, OIDC or
  LDAP; API tokens can be limited to MCP.

See [Lifecycle and review](07-lifecycle-and-review.md), [Versions and channels](10-versions-and-channels.md) and
[Teams, visibility and ownership](11-teams-visibility-ownership.md) for the behaviour around these fields.

## Artifact types and canonical bundles

The canonical formats follow Claude Code plugins and the agentskills.io skill format. Details are in
[Artifact types](05-artifact-types.md).

| Type | Input when publishing | Canonical bundle in storage | Distribution |
|---|---|---|---|
| `skill` | folder with `SKILL.md` (+ `scripts/`, `references/`, `assets/`) | `skills/<name>/SKILL.md…` | every supported agent; plugin `skills/` |
| `command` | one `<name>.md` | `commands/<name>.md` | agents that support commands; plugin `commands/` |
| `agent` | one `<name>.md` with frontmatter | `agents/<name>.md` | agents that support subagents; plugin `agents/` |
| `hook` | folder with `hooks.json` (+ `scripts/`, `README.md`) | `hooks/hooks.json`, `scripts/…` | Claude Code marketplace |
| `plugin` | Claude Code plugin bundle with `.claude-plugin/plugin.json` and components | the bundle files as they are | Claude Code marketplace |
| `settings` | `SETTINGS.md` + `settings.json` | `settings/<name>/…` | `skillforge settings apply`, not the marketplace |
| `mcp-server` | `MCP.md` + `server.json` | `mcp/<name>/…` | described in the catalog; configured in the agent by hand |

The author's frontmatter is never rewritten: the digest covers exactly what was published. Registry metadata (status,
provenance, evidence, counters) lives in the database. Bundle limits: 32 MiB in total, 16 MiB per file, at most
1000 files.

## Storage and integrity

- The bundle digest is the sha256 of the string `"<path>\0<sha256>\n"` repeated for every file, sorted by path
  (UTF-8 byte order).
- Every stored file is checked against its hash when read; a damaged copy answers `blob_corrupt` and is never served.
- The registry signs every version with its Ed25519 key over the type, name, version, digest and file list. The key id
  is the first 16 hex characters of the sha256 of the public key. `GET /api/v1/install-info` publishes the public key,
  and `skillforge install` and `sync` check the signature before writing files.

## Distribution

- **Marketplace.** `GET /marketplace.json` (also `/api/v1/marketplace.json`) returns a Claude Code
  `.claude-plugin/marketplace.json`. By default it lists `active` artifacts; `?status=candidate,active` gives a preview
  and `?type=` filters by type. `settings` and `mcp-server` are not listed. Each entry's source follows
  `SKILLFORGE_MARKETPLACE_SOURCE`: an `archive` (a zip with its `sha256`) or a `command` that runs
  `skillforge plugin-dir` on the client.
- **Plugin archives.** `GET /api/v1/plugins/<type>/<name>/<version>.zip` (plugin root at the archive root) and
  `.tar.gz`, built from the canonical bundle plus `.claude-plugin/plugin.json`.
- **CLI.** `skillforge install <type>/<name>[@spec] [--runtime <id>] [--scope project|user]` writes the bundle into the
  agent's folders, translating commands and agents for runtimes that need it; `--into <dir>` sets the install root
  (default `.claude`). The CLI records what it installed in `.skillforge-lock.json`. Supported runtimes are listed by
  `GET /api/v1/runtimes`; see [Agents](agents/README.md).
- **MCP.** `POST /mcp` (or the `skillforge mcp` stdio bridge) offers agents `search_artifacts`, `get_artifact`,
  `read_artifact_file` and `record_usage` over JSON-RPC 2.0, for `active` artifacts only. See [MCP](13-mcp.md).
- **CLI download.** `/downloads/skillforge-cli.tgz` serves the CLI package from `SKILLFORGE_DOWNLOADS_DIR`.

## Channels and pins

- Every version has the channel `stable` or `beta`. A version with a semver pre-release suffix is always `beta`; any
  other is `stable` unless the publish request sets `channel: "beta"`.
- `latest_version` is the highest `stable` version, or the highest version of any channel when there is no stable one.
  The marketplace, MCP and the CLI all read this one field.
- `GET /api/v1/artifacts/<type>/<name>/resolve?spec=` resolves `latest`, `beta`, an exact `1.2.3` or `=1.2.3`, or a
  semver range (stable versions only). A spec longer than 64 characters answers `400 spec_invalid`.
  `POST …/versions/<version>/channel` (contributor or higher, not an MCP token) changes the channel and recomputes
  `latest` in one transaction, audited as `channel_change`.
- The CLI saves any spec other than `latest` as `pin` in `.skillforge-lock.json`. `install` without a spec keeps the pin,
  `@latest` clears it, and `sync` resolves the pin instead of `latest`. A downgrade needs `--allow-downgrade` (`sync`
  skips the artifact, `install` exits with code 5). `skillforge outdated [--json]` shows installed, wanted, latest and pin.

## HTTP API

All REST routes are under `/api/v1`. The main ones:

| Area | Routes |
|---|---|
| Health and install | `GET /health`, `GET /install-info`, `GET /runtimes`, `GET /artifact-types` |
| Catalog | `GET /artifacts?type&q&status&tag&team`, `GET /artifacts/facets`, `GET /artifacts/:type/:name` |
| Publishing | `POST /artifacts/validate`, `POST /artifacts` |
| Versions | `GET …/versions`, `GET …/versions/:version`, `GET …/versions/:version/files/*`, `GET …/versions/:version/bundle.zip`, `GET …/diff`, `GET …/resolve` |
| Lifecycle | `POST …/transitions`, `GET /lifecycle/board`, `POST /lifecycle/batch-transitions` |
| Audit | `GET …/audit`, `GET /admin/audit` |
| Import | `POST /imports/preview`, `POST /imports/run` |
| Auth and account | `POST /auth/login`, `POST /auth/logout`, `GET /auth/providers`, `GET /me`, `GET /me/tokens`, `POST /me/tokens` |
| Administration | `/admin/*`: users, backups, plugins, policies, mirrors, inventory, report, diagnostics |
| Server plugins | `/ext/<plugin>/*` |

`…` stands for `/artifacts/:type/:name`. Outside `/api/v1` the server answers `GET /marketplace.json`, `/mcp` and
`/downloads/:file`, and serves the web app for every other path.

## Server plugins

Server plugins extend the registry without changing the core. Each subfolder of `SKILLFORGE_PLUGINS_DIR` with a
`skillforge-plugin.json` manifest is loaded at startup; a failing plugin is isolated and the server keeps running.
Plugins can add routes under `/api/v1/ext/<name>`, listen to events, keep their own `ext_<name>_*` tables, set badges
on artifact cards and contribute pages and artifact tabs to the web app. Plugin code runs with the privileges of the
server process. See [Plugins](14-plugins.md).
