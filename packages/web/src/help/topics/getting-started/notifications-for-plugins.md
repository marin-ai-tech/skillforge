---
title: Notifications for plugins
summary: How server plugins observe comment and notification events and send their own bounded notifications.
section: automation
learn:
  - Which comment and notification events plugins receive
  - How to send notifications from a plugin and which limits apply
  - Which trust rules apply to plugin notifications
related: getting-started/notifications-and-watch, pages/admin-plugins
---

Plugins on API `1` can observe comment and notification traffic and send bounded `plugin`-kind notifications through `ctx.notifications.send`. Full platform details live in `docs/en/14-plugins.md`; this topic summarizes the contract for authors.

## Events

- **`comment.created`** — payload includes `comment` (`id`, `artifact`, `version`, `parent_id`, `author`, `ref`, `excerpt` ≤ 200) and `mentions`. Fired after a successful create; plugins never receive the full body when it would exceed the excerpt.
- **`notification.created`** — payload includes `notification` (`id`, `username`, `kind`, `artifact`, `title`, `url`). Useful for bridges that forward in-app alerts elsewhere.

Subscribe with the existing `ctx.events.on(...)` helpers from the plugin platform. Events carry only text the platform already stores — treat them as untrusted input in your plugin UI.

## ctx.notifications.send

```js
await ctx.notifications.send({
  users: ["alice", "bob"], // max 20
  title: "Review finished", // max 120
  text: "Optional detail", // max 500
  url: "/artifacts/skill/x",
  artifact: { type: "skill", name: "x" },
  version: "1.2.0",
});
```

The helper inserts `kind: "plugin"` rows for users who can view the artifact (when given) and whose prefs allow `plugin`. Limits: 200 sends per hour per plugin; recipients are de-duplicated. Review-assistant uses this path to notify the publisher about a review decision.

## Trust model

> [!WARNING]
> Plugins must not assume HTML is safe — send plain titles/text. Do not use notifications to exfiltrate secrets.

Prefer linking to registry paths (`/artifacts/...`) over external URLs when possible.