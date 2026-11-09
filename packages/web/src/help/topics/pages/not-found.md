---
title: Page not found
summary: The not-found page appears for unknown addresses and for artifacts that do not exist. Read it to tell a missing page from a permission problem and recover quickly.
section: ui-other
learn:
  - When the not-found page appears
  - How to recover from a wrong or stale link
  - How not-found differs from an authorization error
related: pages/home, pages/catalog
---

## What this page is for

The not-found experience appears for unknown SPA paths and for artifact detail URLs whose type/name pair does not exist (API 404). The element uses `data-testid="not-found"` and includes the missing name when relevant (for example `does-not-exist`). Use it as a signal to correct the URL, return to Catalog, or publish the artifact you expected. It is not an authorization error—forbidden actions use different messaging after sign-in. Shared navigation remains so you can recover without relying on the browser back button.

## What you see

- A clear not-found message and `not-found` test id.
- Echo of the missing path or artifact name when provided by the router or API error.
- Navigation still present: Home, Catalog, search, theme toggle, help.
- No artifact tabs or version selector, because there is no loaded entity.
- Optional guidance to search the catalog or open Help center.

## Common tasks

1. Read the missing name or path in the message.
2. Click Catalog and search for a similar artifact name.
3. Check that the type segment is one of skill, command, agent, or hook.
4. If you intended to publish, open Publishing an artifact and create the first version.
5. Use nav search (Ctrl/Cmd+K) to jump to `/artifacts?q=...`.
6. Open Help center if you followed a stale documentation link.

## Permissions

Visible to anonymous and signed-in users alike. Seeing not-found does not mean you lack role permission; a viewer who may not publish still receives 404 for missing artifacts. True authorization failures on write APIs return 401/403 instead of this page.
