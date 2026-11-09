---
title: Folder picker
summary: Picks a local folder as the import source when the source is folder. Use it to import an agent folder or a plugin tree straight from disk.
related: pages/import
---

## What it does

Opens the browser's folder dialog and loads every file inside the chosen folder with its path relative to that folder. Files under `node_modules` and `.git` are dropped in the browser; when you click Preview, the rest is uploaded and scanned for artifact packages. Picking another folder clears the previous preview.

## When to use

Choose folder in the Source list, then pick the directory, for example a project's agent folder (`.claude`, `.codex` and so on) or a checked-out plugin. An import may hold at most 5000 files and 64 MB; a larger tree fails with import_too_large. Preview without a folder asks you to choose one first.

## Requires

Sign-in with contributor or higher on the Import page and a browser that supports folder selection; current Chrome, Edge, Firefox and Safari do.
