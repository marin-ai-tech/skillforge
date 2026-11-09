---
title: Git repository URL
summary: Sets the address of the git repository to import from. Use it when the source is git; Preview clones the repository and scans it for packages.
related: pages/import
---

## What it does

Accepts `https://`, `ssh://` and `git@host:path` addresses. When you click Preview, the server makes a shallow clone (latest commit only, two-minute timeout) and scans it for artifact packages. `file://` URLs and local paths work only when the administrator has enabled `SKILLFORGE_IMPORT_ALLOW_FILE_URLS`; any other address is rejected with import_url_not_allowed.

## When to use

To import from a remote repository instead of uploading files. With an empty field, Preview asks you to enter a git URL. Credentials in the URL are hidden in error messages, but the clone runs with the server's own git setup.

## Requires

Sign-in with contributor or higher and git selected as the source. The server needs git, network access to the host and git import turned on (`SKILLFORGE_IMPORT_GIT`, on by default); otherwise Preview fails with import_git_disabled.
