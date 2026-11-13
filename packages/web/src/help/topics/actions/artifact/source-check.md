---
title: Check the source now
summary: Checks the tracked source of this artifact right away instead of waiting for the background check. Use it after an upstream release or after changing the branch or tag.
related: getting-started/tracked-sources, pages/artifact
---

## What it does

Runs one check of the tracked source (`POST …/source/check`): finds the upstream commit, applies the quarantine and the edit rules, runs the import checks and, when the folder changed, publishes a new version in the `beta` channel. The panel then shows the result: a new version, no changes, waiting in quarantine with the time it can be taken, or the reason the check failed.

## When to use

Use it when you know a new upstream release is out, after you pinned another branch or tag, or to confirm that a problem was fixed. The background check runs anyway with the mirrors.

## Requires

The owner, a maintainer or an admin, with tracking turned on: a disabled source answers `409 source_disabled`.
