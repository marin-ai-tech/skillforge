# Server plugins

This page is for the people who run a SkillForge server. It explains server plugins: how an admin installs,
enables and configures them, what a plugin can add to the registry, which trust rules apply, and how the
bundled `review-assistant` plugin works. Server plugins are different from the `plugin` artifact type, which
is a Claude Code plugin bundle published in the catalog (see [Artifact types](05-artifact-types.md)).

## Trust model first

A server plugin is JavaScript that runs inside the SkillForge process, with the same privileges as the server
and full access to its database. The ownership and visibility rules do not sandbox it. Install only plugins
you would trust as application code on that host, and only an admin with access to the server's file system
can install one.

## Installing a plugin

Plugins live on the server file system, in `SKILLFORGE_PLUGINS_DIR` (default `<data_dir>/plugins`). Every
subfolder that contains `skillforge-plugin.json` is a candidate plugin.

1. Copy the plugin folder into the plugins directory, for example `<data_dir>/plugins/hello/`.
2. Restart the server. Plugins are loaded at startup, after database migrations and before the server
   accepts traffic.
3. Open **Plugins** in the user menu (`/admin/plugins`) and check the status of the new row.

Release builds also carry the `review-assistant` plugin in `SKILLFORGE_BUNDLED_PLUGINS_DIR`. A plugin of the
same name in your plugins directory replaces the bundled one.

To stop loading every plugin without deleting folders, start the server with
`SKILLFORGE_PLUGINS_DISABLED=true`.

## The manifest

```json
{
  "name": "hello",
  "version": "1.0.0",
  "api": 1,
  "description": "Routes, a migration, events and UI contributions.",
  "main": "index.js",
  "capabilities": ["routes", "events", "db", "ui"],
  "config_schema": {
    "type": "object",
    "properties": {
      "greeting": { "type": "string", "default": "Hello from config" },
      "shout": { "type": "boolean", "default": false }
    }
  }
}
```

| Field | Rule |
|---|---|
| `name` | kebab-case, at most 64 characters, equal to the folder name |
| `version` | the plugin's version |
| `api` | must be `1` |
| `description` | optional, at most 200 characters |
| `main` | the ES module to load, default `index.js`; must stay inside the plugin folder |
| `capabilities` | mostly informational; `process` and `llm` are required to use those APIs |
| `config_schema` | properties of type `string`, `number`, `boolean` or `array`, with defaults; drives the admin JSON editor |

## Load status and failures

Each plugin ends up in one of three states, shown on `/admin/plugins` and counted in
`GET /api/v1/health` as `plugins: { loaded, errors, disabled }`:

- `loaded` — `register(ctx)` ran without errors;
- `disabled` — an admin turned it off; `register` is skipped;
- `error` — the manifest, the module import, a migration or `register` failed; the row shows the message.

Failures are isolated: a broken plugin becomes `error` while the other plugins and the core server keep
running.

## Administering plugins

The **Plugins** page (`/admin/plugins`, admins only) shows the plugins directory, a trust notice, and a row
per plugin with name, version, description, status, error text and a summary of what it contributes.

- **Enable or disable.** The toggle stores the flag; the change takes effect after a restart, and the row
  shows "restart required" until then. A disabled plugin's badges are hidden.
- **Configure.** Edit the JSON configuration and save. The server validates it against `config_schema`; on
  success the plugin sees the new values immediately, without a restart. An invalid value or unknown key is
  refused with `config_invalid`.

The same operations are available as `GET /api/v1/admin/plugins` and `PATCH /api/v1/admin/plugins/<name>`.
Other roles get `403`.

## What a plugin can add

The module exports `register(ctx)`. The context offers:

| Area | What it gives |
|---|---|
| `logger` | console output prefixed with the plugin name |
| `config.get()` | the stored configuration merged with schema defaults, re-read on every call |
| `routes.register`, `routes.public` | HTTP handlers under `/api/v1/ext/<name>`; public ones answer without sign-in |
| `auth.requireRole` | role checks inside a handler |
| `events.on` | registry events (see below) |
| `db.migrate`, `db.prepare`, `db.exec` | SQL migrations and queries; tables and indexes must be named `ext_<name>_*` |
| `registry` | read-only access to artifacts, versions and files, plus `addEvidence`, `setBadge`, `clearBadge` |
| `notifications.send` | in-app notifications of kind `plugin` |
| `ui.nav`, `ui.page`, `ui.artifactTab` | a header link, a markdown page under `/ext/<plugin>/<page>`, and a tab on the artifact page after Install |
| `process.spawnIsolated` | start an external process without a shell (needs the `process` capability) |
| `llm` | call the model connected on the Assistant page by purpose; the key never reaches the plugin (needs `llm`) |

Event handlers run after the database commit. An exception in a handler is logged and never fails the
original request. The events are:

- `artifact.published`, `artifact.transitioned`, `version.validated`, `artifact.purged`;
- `agent.scanned` — a snapshot was saved, with its status summary;
- `comment.created` — with an excerpt of at most 200 characters and the mentions;
- `notification.created`;
- `auth.login`, `server.started`.

A plugin that stores content derived from a version must delete it when it receives `artifact.purged`.

### Badges

`registry.setBadge(type, name, badge)` puts a short badge on the artifact card: an `id`, a tone `ok`, `info`,
`warn` or `danger`, a `label` of at most 40 characters, and optional `labels` with the text per interface
language. The catalog never calls plugin code per card; it shows the stored badge.

### Notifications

```js
await ctx.notifications.send({
  users: ["alice", "bob"],            // at most 20, de-duplicated
  title: "Review finished",           // at most 120 characters
  text: "Optional detail",            // at most 500 characters
  url: "/artifacts/skill/x",
  artifact: { type: "skill", name: "x" },
  version: "1.2.0",
});
```

Notifications go only to users who can see the artifact (when one is given) and who allow plugin
notifications. A plugin may send at most 200 per hour. Send plain text, not HTML, and prefer registry paths
over external links.

### Extension pages

Pages added with `ui.page` render as markdown at `/ext/<plugin>/<page>`; raw HTML is skipped, never executed.
Their header links appear after Help for everyone who can read the registry, including anonymous visitors
when public read is on. If a link disappears, check the plugin's status on `/admin/plugins`.

## The review-assistant plugin

`review-assistant` adds an independent review of artifact versions on the artifact page's **Review** tab.

- **Run.** A reviewer or admin starts a run on the tab, or, with the plugin option `auto_on_publish`, every
  publish starts one. Several external reviewers, each a different model, audit the version against a
  checklist. A judge merges their findings with an agreement count. One run per version at a time.
- **Findings.** Each finding has a category, a file and line, a severity, the agreement count and a
  suggestion. A reviewer decides each one: **Fix**, **Verify**, **Defer** (with a reason) or **Reject**.
  Decisions are recorded with the reviewer's name, and the publisher of the version is notified of each
  decision.
- **Result.** A finished run by external reviewers is stored as evidence on the version, and the artifact
  card gets a badge such as "Review: 2 findings" or "Review: clean".

Reviewers are defined by the operator in the JSON file named by `SKILLFORGE_REVIEWERS_FILE`. The plugin reads
it at the start of every run, so models can be added or removed without a restart. Without a file, or with an
empty list, a run answers `reviewers_not_configured`.

```json
{
  "reviewers": [
    { "id": "strict", "command": ["claude", "-p", "--output-format", "json"], "env": {} },
    { "id": "lenient", "command": ["codex", "exec", "--sandbox", "read-only"], "env": {} }
  ]
}
```

Each entry has an `id`, a `command` as an argument array, an optional `env` and an optional `timeout_s`
(default 300). Reviewers must run without tools, so that they cannot read the operator's files or tokens or
reach the network: for Claude Code, `claude -p` with an empty tool list and `--output-format json`; for
Codex, `codex exec --sandbox read-only`. The plugin starts them directly, without a shell, passes an allowlisted
environment plus the entry's `env`, and kills the whole process tree on timeout.

### Skill checks with the connected model

When a model is connected on the Assistant page and skill checks are on, every published skill version also
gets a background check by the single reviewer `llm`, with no reviewers file needed. Publishing does not wait
for it. A finding is kept only if its quote is really in the file. A check does not change the status and
does not count as review evidence; no findings does not mean the skill is safe. See
[Backups and operations](20-backups-and-operations.md) for the model settings.

## See also

- [Self-hosting](03-self-hosting.md) — environment variables, including the plugin and reviewer settings.
- [Quality and security](09-quality-and-security.md) — the review assistant in the review flow.
- In-app help: `getting-started/plugins`, `pages/admin-plugins`, `pages/ext-page`,
  `getting-started/notifications-for-plugins`, `getting-started/review-assistant`.
