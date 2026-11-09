---
title: Import preview
summary: Scans the chosen zip, folder, or git source for artifact candidates and validates each one as a dry run. Use it after selecting a source to see what Run would publish; nothing is written to the catalog.
related: pages/import
---

## What it does

Materializes the chosen zip, folder, or git source, scans for artifact candidates, and returns dry-run validation for each plus skipped paths. Creates a short-lived import id used by Run.

## When to use

Use after selecting a source. Preview does not write catalog artifacts; it only stages files under the server import TTL window.

## Requires

Requires sign-in with contributor or higher.
