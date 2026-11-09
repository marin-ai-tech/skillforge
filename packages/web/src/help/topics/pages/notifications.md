---
title: Notifications
summary: Notifications is your personal feed of mentions, comments, new versions, status changes and plugin messages. Use it to catch up and choose which kinds still alert you.
section: ui-workspace
learn:
  - What each notification row shows and how rows become read
  - How to mark all notifications read
  - How to turn notification kinds on or off
  - Which notifications you can see
related: getting-started/notifications-and-watch, actions/notifications/notifications-mark-all
---

## What this page is for

`/me/notifications` is your personal feed of registry events: mentions, comments, new versions, status changes, and plugin messages. Use it to catch up without opening every artifact card, and to tune which kinds still alert you.

## What you see

Each `notification-row` shows title, kind, actor, artifact, and time. Unread rows are highlighted; opening a safe internal link marks that row read. The unread counter and **Mark all read** button sit above the list. Below, preference checkboxes (`notif-pref-<kind>`) control delivery; **mention** cannot be turned off.

## Common tasks

Open a row to jump to the artifact (and comments when the URL includes `?comment=`). Mark everything read after a busy morning. Disable `new_version` or `plugin` noise while keeping mentions. Pair with **watch-toggle** on cards you want to follow closely.

## Permissions

Only your own notifications appear. Rows for artifacts you can no longer view are omitted. Anonymous users are redirected to sign in via `RequireUser`.
