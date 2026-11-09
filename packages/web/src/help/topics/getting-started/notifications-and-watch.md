---
title: Notifications and watching
summary: How SkillForge tells you about comments, mentions, new versions and status changes on artifacts you care about.
section: lifecycle
learn:
  - Who receives each kind of notification
  - How to set notification preferences
  - How watching an artifact works and how to stop it
related: getting-started/comments-and-threads, getting-started/notifications-for-plugins, pages/notifications
---

When something happens on an artifact you care about, SkillForge writes an in-app notification. The nav **bell** (`nav-notifications`) shows an unread badge (`notif-count`) for signed-in users. Open `/me/notifications` for the full feed, mark-as-read controls, and per-kind preferences.

## Who gets notified and when

Recipients depend on the event:

- **comment** — author of a parent comment, thread participants, owner, maintainers, and watchers (never the actor).
- **mention** — accepted `@username` targets (cannot be disabled in prefs).
- **new_version** — owner, maintainers, watchers, and users whose agent snapshots depend on the artifact.
- **status_change** — owner, maintainers, watchers.
- **plugin** / review decisions — via `ctx.notifications.send` with visibility checks.

Hidden artifacts never leak: the feed re-filters by current visibility. One event yields at most one notification per user (`mention` wins over `comment`).

## Preferences and the bell

Kinds `comment`, `new_version`, `status_change`, and `plugin` have toggles (`notif-pref-<kind>`). **mention** stays on. The bell polls about every 60 seconds and on window focus; polling stops for anonymous users and after `401`. Mark one row read by opening it, or use **Mark all read** (`notifications-mark-all`).

## Watching an artifact

`watch-toggle` on the card header (signed-in) follows `viewer.watching` from the artifact API. Watching adds you to recipient lists for comments, new versions, and status changes.

> [!NOTE]
> Commenting auto-watches (`source=auto`); you can turn watch off with the toggle or `skillforge watch <type>/<name> --off`.