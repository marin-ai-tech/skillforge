---
title: Plugins administration
summary: Plugins administration shows server plugins with their load status and errors. Use it to enable or disable plugins and edit their JSON configuration.
section: ui-admin
learn:
  - What the plugin table and status chips show
  - How to enable or disable a plugin and when a restart is needed
  - How to edit and save plugin configuration
  - Who may use the plugin admin APIs
related: getting-started/plugins, actions/plugins/menu-plugins, actions/plugins/plugin-toggle, actions/plugins/plugin-config-save, getting-started/self-hosting
---

## What this page is for

Plugins administration is the admin-only UI for reviewing SkillForge server plugins discovered under the configured plugins directory. Each plugin is a folder with `skillforge-plugin.json` and an ES module that can register HTTP routes under `/api/v1/ext/<name>`, subscribe to registry events, run prefixed SQLite migrations, and contribute navigation links or artifact tabs. Use this page to see load status, read errors from broken plugins, toggle enablement (requires restart), and edit JSON configuration that applies without a restart when valid. Only administrators may call the plugin admin APIs.

## What you see

- The plugins directory path (`plugins-dir`) resolved from `SKILLFORGE_PLUGINS_DIR` or `<data_dir>/plugins`.
- A short trust-model notice: plugin code runs with the same privileges as the server process.
- A table (`plugins-table`) of rows (`plugin-row`) with name, version, description, status chip (`plugin-status` text `loaded`, `error`, or `disabled`), optional error text (`plugin-error`), and a contribution summary.
- Per-row enable toggle (`plugin-toggle`) that shows `plugin-restart-required` after a change until the process restarts.
- A JSON config editor (`plugin-config`) with Save (`plugin-config-save`), plus shared `admin-notice` / `admin-error` banners (including `config_invalid`).
- An empty state (`plugins-empty`) when no plugins are present or the kill-switch emptied the list.

## Common tasks

1. Sign in as admin and open Plugins from the user menu (`menu-plugins`) or go to `/admin/plugins`.
2. Confirm the directory path and scan statuses for `loaded`, `error`, and `disabled`.
3. Toggle a plugin off when you need to stop it after the next restart; note the restart-required badge.
4. Edit config JSON and save; on success the notice appears and routes/events use the new values immediately.
5. On validation failure, read `admin-error` (`config_invalid`) and fix types or unknown keys.

> [!IMPORTANT]
> After enablement changes, restart the SkillForge process so load status matches the stored flags.

## Permissions

Requires role admin. Viewer, contributor, and reviewer receive 403 on admin plugin APIs and see `admin-forbidden` on this page. Anonymous users are redirected to `/login?next=/admin/plugins`. Enabling or disabling a plugin only updates the `plugins` table until restart; config patches apply immediately when the schema accepts them.
