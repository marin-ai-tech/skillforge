---
title: Skip conflicts
summary: Skips candidates whose digest or version is already published instead of failing them; it is on by default. Use it when re-importing a source that was partly imported before.
related: pages/import
---

## What it does

A checkbox next to Import selected, checked by default. When a candidate's digest or version already exists in the catalog, the run reports it as skipped with the reason digest_exists or version_exists; with the box cleared, the same candidate is reported as failed. Other candidates are published either way.

## When to use

Keep it on for repeated imports of the same source, so unchanged packages are skipped quietly. Clear it when every candidate should be new and you want conflicts to stand out as failures in the results.

## Requires

Sign-in with contributor or higher and a completed Preview. It does not override ownership: a package owned by another user still fails with not_owner.
