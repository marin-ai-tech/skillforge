---
title: Add maintainer
summary: Adds a co-author who may publish new versions of the artifact without becoming its owner. Use it to share release rights with collaborators instead of relying on reviewer overrides.
related: getting-started/ownership, actions/artifact/remove-maintainer
---

## What it does

Adds a co-author username to `artifact_maintainers` so they may publish new versions of this artifact without becoming the owner. The list on the card updates after a successful call.

## When to use

Grant publish rights to collaborators who should not own the artifact. Prefer this over asking a reviewer to use publish-override for routine releases.

## Requires

Current owner or admin; the username must identify an enabled contributor or higher and must not be the owner. MCP tokens are rejected.
