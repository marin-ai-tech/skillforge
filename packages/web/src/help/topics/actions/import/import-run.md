---
title: Import run
summary: Publishes the selected import candidates one by one and records the import on each publish audit event. Use it after Preview shows Ready or Warnings rows you intend to publish.
related: pages/import
---

## What it does

Submits selected import candidates to `POST /api/v1/imports/run`, publishing each package sequentially with dry-run conflict handling and writing `meta.import` on the publish audit event. The import id is deleted after the run.

## When to use

Use after Preview shows Ready or Warnings rows you intend to publish. Prefer skip-conflicts when re-importing an unchanged tree so digest matches become skipped instead of failed.

## Requires

Requires sign-in with contributor or higher. Viewers are forbidden on the Import page.
