---
title: Publish submit
summary: Submits the package and creates an immutable version, or returns validation errors and conflicts. Use it once all Blocking issues are cleared.
related: pages/publish
---

## What it does

Submits the package to POST /api/v1/artifacts, creating an immutable version or returning validation errors and conflicts (version_exists, digest_exists).

## When to use

Use after all Blocking issues are cleared. Prior versions are never mutated on conflict.

## Requires

Requires sign-in with contributor+ (viewer is forbidden).
