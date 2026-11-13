---
title: Turn source tracking on or off
summary: Turns the tracked source of this artifact on or off. A disabled source is never checked, so no new beta versions arrive from upstream.
related: getting-started/tracked-sources, pages/artifact
---

## What it does

Saves `enabled` on the tracked source (`PUT …/source`). When tracking is off, neither the background check nor Check now looks at the upstream folder; the source, its last commit and its edit rules stay as they are. Turning it on again resumes checks from the last commit taken.

## When to use

Turn it off when the artifact now lives here and upstream changes are no longer wanted, or while the upstream folder is broken. Turn it on to receive upstream releases as beta versions again.

## Requires

The owner, a maintainer or an admin. The change is recorded in the audit log.
