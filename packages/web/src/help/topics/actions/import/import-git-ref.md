---
title: Git branch or tag
summary: Sets an optional branch or tag to import from the git repository. Use it to import a specific release instead of the default branch.
related: pages/import
---

## What it does

Passes the value to a shallow clone (`git clone --depth 1 --branch`), so only the latest commit of that branch or tag is fetched. The ref must start with a letter or digit and may contain letters, digits, dots, underscores, hyphens and slashes, up to 128 characters, for example `main`, `v1.4.0` or `release/2026-10`. A commit hash does not work here, because clone accepts only branch and tag names.

## When to use

Leave it empty to import the repository's default branch. Fill it in to import a tagged release or a feature branch; an unknown ref makes the clone fail, and Preview shows the git error.

## Requires

Sign-in with contributor or higher, git selected as the source, and a repository URL.
