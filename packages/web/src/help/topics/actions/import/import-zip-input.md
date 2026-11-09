---
title: Zip file picker
summary: Picks a zip archive, such as a plugin archive, as the import source. Use it when the source is zip, before clicking Preview.
related: pages/import
---

## What it does

Opens a file dialog limited to zip files. The archive stays in the browser until you click Preview; then it is uploaded, unpacked on the server and scanned for artifact packages. If all entries share one top-level folder, that folder is stripped, so an archive of a single project folder works as is.

## When to use

For plugin archives and zipped agent folders. The unpacked archive may hold at most 5000 files and 64 MB; a larger one fails with import_too_large, and an empty or broken archive is rejected. Choosing another file clears the previous preview.

## Requires

Sign-in with contributor or higher on the Import page and zip selected as the source, which is the default.
