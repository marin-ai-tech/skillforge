---
title: Channels and version pinning
summary: How stable and beta channels let authors ship experiments to volunteers and let consumers pin a version they have verified.
section: publishing
learn:
  - Which versions land in beta and which become latest
  - How to promote or demote a version between channels
  - Which install specs you can use
  - How pins, sync and downgrade protection work
related: getting-started/versions-and-digests, getting-started/cli, actions/artifact/set-channel
---

Every published version belongs to a release channel: `stable` or `beta`. Channels let authors ship experimental versions to volunteers without pushing them to everyone who runs `skillforge sync`, and let consumers pin a version they have already verified.

## Stable and beta

A version with a semver pre-release suffix (for example `0.3.0-beta.1`) is published to `beta` automatically and can never be moved to `stable`. Any other version is `stable` by default; pass `"channel": "beta"` in the publish request to ship it as beta instead. `latest` is the highest `stable` version. If an artifact has only beta versions, `latest` is the highest beta and the card marks it with a `beta` chip. The artifact header shows the latest stable version and, when a newer beta exists, that beta too. Marketplace, MCP and plain installs keep following `latest`, so a beta version reaches only people who ask for it.

## Promoting a version

On the Versions tab a contributor can press `set-channel` for a version and confirm. Promoting a beta version to stable can make it the new `latest`; moving a stable version back to beta removes it from `latest` without deleting anything. Each change is written to the audit log as `channel_change`.

## Version specs

`skillforge install type/name@spec` accepts `@latest` (highest stable, clears a pin), `@beta` (highest version in any channel), an exact `@1.2.3` or `@=1.2.3`, or a semver range such as `@^1.2`. Ranges are matched against stable versions only. Specs longer than 64 characters or with unexpected characters are rejected with `spec_invalid`.

## Pins, sync and downgrades

Any spec other than `latest` is saved as `pin` in the lock file. `install` without a spec keeps the existing pin, and `sync` resolves each pin instead of `latest`. An invalid pin in the lock is ignored with a warning. Run `skillforge outdated` (or `--json`) to compare installed, wanted (pinned) and latest versions.

> [!NOTE]
> SkillForge never downgrades silently: `sync` skips the artifact and `install` exits with code 5 unless you pass `--allow-downgrade`.