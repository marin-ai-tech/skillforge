---
title: Plugin extension pages
summary: Extension pages are markdown documents contributed by loaded plugins. Read this to find them, know what they can show and fix a page that is missing.
section: ui-other
learn:
  - Where plugin pages appear in navigation
  - How plugin markdown is rendered and what is skipped
  - What the missing state means and how to fix it
  - How plugin authors add pages
related: getting-started/plugins, pages/admin-plugins, pages/artifact
---

## What this page is for

Extension pages are markdown documents contributed by loaded plugins and shown at `/ext/:plugin/:page`. Plugins register navigation entries that appear in the shell after Help for everyone (including anonymous visitors when public read is enabled). Use these pages for plugin-specific documentation, dashboards described in markdown, or operational notes that do not need a full React UI. The server returns title and markdown from `GET /api/v1/plugins/ui/pages/...`; the client renders with `react-markdown`, GFM, and `skipHtml` so raw HTML is never executed or shown as text.

## What you see

- A page shell (`ext-page`) with the plugin-provided title (`ext-page-title`) and a browser tab title made of the plugin page title followed by · SkillForge (Plugin page · SkillForge until the title loads).
- Markdown body with headings, lists, and emphasis; script tags and other HTML from the plugin are skipped.
- A missing state (`ext-page-missing`) when the plugin is not loaded or the page id is unknown.
- Header navigation links `nav-ext-<plugin>-<id>` that route to the corresponding `/ext/...` path.

## Common tasks

1. From the catalog header, click a plugin nav link such as Hello after Help.
2. Read the markdown content; confirm the browser tab title matches the page title.
3. If you open an unknown path, expect the missing state instead of a blank page.
4. Authors: implement `ui.nav` and `ui.page` in the plugin `register(ctx)` and keep markdown free of relying on HTML.
5. Admins: if a link disappears, check `/admin/plugins` for disabled or error status and restart after re-enabling.

## Permissions

Reading extension pages follows `SKILLFORGE_PUBLIC_READ` for the plugins UI API. Anonymous users can open contributed pages when public read is true. Writing plugin code or config still requires filesystem access and admin APIs; viewers cannot change plugin enablement from this page.
