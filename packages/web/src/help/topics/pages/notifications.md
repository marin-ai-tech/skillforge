---
title: Notifications
summary: Notifications is your personal feed of mentions, comments, new versions, status changes, plugin messages and MCP server versions. Use it to catch up and choose which kinds still alert you.
section: ui-workspace
learn:
  - What each notification row shows and how rows become read
  - How to mark all notifications read
  - How to turn notification kinds on or off
  - Which notifications you can see
  - How the news summary and the personal Atom link deliver news
related: getting-started/notifications-and-watch, actions/notifications/notifications-mark-all
---

## What this page is for

`/me/notifications` is your personal feed of registry events: mentions, comments, new versions, status changes, plugin messages, and MCP server versions (`mcp_version`). Use it to catch up without opening every artifact card, and to tune which kinds still alert you.

## What you see

Each `notification-row` shows title, kind, actor, artifact, and time. Unread rows are highlighted; opening a safe internal link marks that row read. The unread counter and **Mark all read** button sit above the list. Below, preference checkboxes (`notif-pref-<kind>`) control delivery; **mention** cannot be turned off. The news summary is not among them: its period in **News delivery** is its only setting.

## Common tasks

Open a row to jump to the artifact (and comments when the URL includes `?comment=`). Mark everything read after a busy morning. Disable `new_version` or `plugin` noise while keeping mentions. Pair with **watch-toggle** on cards you want to follow closely.

## News delivery

The **News delivery** section sets how news reaches you outside the web. **News summary** (`news-summary-period`) is `off`, `daily` or `weekly` (the default); the summary comes as a notification on this page and to the plugins your admin installed, for example mail or chat. It comes at 09:00 server time: every day, or on Mondays for the past week. `off` stops it everywhere, both the notification and the plugins. The server itself sends no e-mail, and an empty summary is not sent.

The **Atom link** (`news-atom`) is for a feed reader that cannot send a token. **Create a link** shows the address once, with a copy button; after a reload you see only its prefix and date. **Replace the link** and **Revoke** ask first: the old link stops working at once. The News page links here with **Subscribe in a feed reader**.

> [!WARNING]
> The Atom link works without a password: anyone who has it reads the news you can see. Keep it private and replace it if it leaks. It opens only your news feed, not the rest of the API.

## Permissions

Only your own notifications appear. Rows for artifacts you can no longer view are omitted. Anonymous users are redirected to sign in via `RequireUser`.
