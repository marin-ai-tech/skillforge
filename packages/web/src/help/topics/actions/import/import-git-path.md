---
title: Git subdirectory
summary: Sets an optional folder inside the git repository to scan. Use it when the packages do not live at the repository root.
related: pages/import
---

## What it does

Limits the scan to one folder of the cloned repository, written as a relative path with forward slashes, such as `plugins/review`. The path may be up to 200 characters and must not start with a slash, contain `..` or a backslash, or begin with a drive letter. Leave it empty to scan the whole repository.

## When to use

For monorepos and repositories where the packages sit in a subfolder, such as `.claude/skills`. If the folder does not exist in the cloned branch, Preview fails with a git error instead of returning an empty list.

## Requires

Sign-in with contributor or higher, git selected as the source, and a repository URL. Git import must be enabled on the server.
