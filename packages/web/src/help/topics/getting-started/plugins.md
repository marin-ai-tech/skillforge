---
title: Extending SkillForge with plugins
summary: How self-hosted operators extend the registry with server plugins without forking the core. Plugins run as trusted application code.
section: automation
learn:
  - What a plugin manifest declares
  - How plugins are loaded and how failures are isolated
  - What the register context offers
  - Which trust rules apply to plugins
related: pages/admin-plugins, pages/ext-page, getting-started/self-hosting, actions/plugins/plugin-toggle
---

SkillForge has a first-party plugin platform so self-hosted operators can extend the registry without forking the core server. Plugins live on the server filesystem under `SKILLFORGE_PLUGINS_DIR` (default `<data_dir>/plugins`); release builds also carry the `review-assistant` plugin in `SKILLFORGE_BUNDLED_PLUGINS_DIR`, and a plugin of the same name in your folder replaces it. Each subdirectory that contains `skillforge-plugin.json` is treated as a candidate plugin. The manifest declares a kebab-case `name` that must match the folder name, a semver `version`, `api` which must equal `1`, an optional description, `main` (default `index.js`), `capabilities` (a plugin gets `ctx.process` or `ctx.llm` only when it declares `process` or `llm`), and a limited `config_schema` used by the admin JSON editor.

On startup the server scans and loads plugins after migrations and seed, before HTTP route registration and before accepting traffic, unless `SKILLFORGE_PLUGINS_DISABLED=true`. When a row in the `plugins` table has `enabled = 0`, the loader skips `register` and reports status `disabled`. Failures while parsing the manifest, importing the module, applying migrations, or running `register` are isolated: that plugin becomes `error` with a message, while other plugins and the core server continue. `GET /api/v1/health` includes `plugins: { loaded, errors, disabled }`.

The `register(ctx)` callback receives a stable context object. Use `logger` for prefixed console output, `config.get()` to read the stored JSON merged with schema defaults (re-read on every call), `routes.register` and `routes.public` for Fastify handlers under `/api/v1/ext/<name>`, `auth.requireRole` for finer checks, `events.on` for `artifact.published`, `artifact.transitioned`, `version.validated`, `auth.login`, and `server.started`, `db.migrate` for one-shot SQL with mandatory `ext_<name>_*` table and index names, `db.prepare` / `db.exec` for queries, a read-only `registry` facade over artifacts and blobs, `registry.setBadge` / `registry.clearBadge` for a short badge on the artifact card (tone `ok`, `info`, `warn` or `danger`; `labels` gives the text per interface language and `label` is the fallback; hidden while the plugin is disabled), and `ui.nav` / `ui.page` / `ui.artifactTab` for catalog contributions. Event handlers run after COMMIT via `setImmediate`; exceptions are logged and never fail the original request.

> [!WARNING]
> Trust model: plugin JavaScript runs with the same privileges as the Node process. Only install plugins you would trust as application code on that host.

> [!TIP]
> Prefer the kill-switch environment variable to stop loading without deleting folders.

Enable and disable require a process restart; configuration patches validate against the schema and apply immediately when accepted. Inspect status on `/admin/plugins`, open contributed pages under `/ext/...`, and use artifact tabs after the Install tab. The repository document `docs/en/14-plugins.md` is the full reference for authors.