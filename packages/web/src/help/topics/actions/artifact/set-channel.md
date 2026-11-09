---
title: Set version channel
summary: Moves a published version between the stable and beta channels without changing its contents. Use it to promote a checked beta or to take a problematic stable release out of latest.
related: getting-started/channels-and-pinning, getting-started/versions-and-digests
---

## What it does

Moves one published version between the `stable` and `beta` channels after a confirmation. The version bytes and digest do not change; only the channel label does. The artifact `latest` is recomputed in the same transaction and an audit event `channel_change` records the version, the old and the new channel.

## When to use

Use "Promote to stable" after a beta version has been checked, or "Move to beta" to take a problematic stable release out of `latest` without deleting it. Pre-release versions such as `1.0.0-beta.1` cannot be stable; the error is shown next to the button.

## Requires

The artifact owner or a maintainer — the same right as publishing a version; a reviewer or admin may change it as an audited override. Sign in with a session or a regular API token (MCP tokens are rejected).
