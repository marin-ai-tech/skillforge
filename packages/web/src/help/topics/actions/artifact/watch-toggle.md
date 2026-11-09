---
title: Watch artifact
summary: Turns watching an artifact on or off, which decides whether you are notified about its comments, versions, and status changes. Use it to follow an artifact you care about or to cut the noise.
related: getting-started/notifications-and-watch, pages/artifact
---

## What it does

Calls `PUT /api/v1/artifacts/:type/:name/watch` with `{ watching: true|false }` and updates the header control from `viewer.watching`. Watching includes you in recipient lists for comments, new versions, and status changes.

## When to use

Follow an artifact you do not own but care about. Turn watch off when the noise is no longer useful. Posting a comment auto-watches for you.

## Requires

Signed-in user who can view the artifact. MCP tokens are rejected. Anonymous visitors do not see the toggle.
