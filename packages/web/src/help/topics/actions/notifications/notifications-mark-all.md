---
title: Mark all notifications read
summary: Marks all notifications you can see as read and clears the unread badge. Use it after skimming the feed, before focusing on new events.
related: getting-started/notifications-and-watch, pages/notifications
---

## What it does

Posts `{ all: true }` to `/api/v1/me/notifications/read` for notifications you can currently see. The unread badge and feed refresh afterward.

## When to use

Clear the bell after you have skimmed the feed, or before focusing on new events. You can still open individual rows to mark one at a time.

## Requires

Signed-in user. Only notifications that pass the visibility filter are updated; hidden artifacts stay unread and invisible.
