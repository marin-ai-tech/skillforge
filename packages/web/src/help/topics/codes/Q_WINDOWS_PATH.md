---
title: Q_WINDOWS_PATH
summary: Advisory: the text contains a Windows-style path outside a Windows shell block, which breaks on the POSIX hosts agents usually run on; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types
---

## What it means

Advisory: the text contains a Windows-style path such as `C:\Users\me\file.txt` outside a shell block meant for Windows. Agents usually run on POSIX hosts, and copied Windows paths break there. Paths inside fenced `powershell`, `pwsh`, `ps1`, `cmd`, `bat` and `batch` blocks are ignored. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Instructions written on a Windows machine; log excerpts pasted into the body; PowerShell examples placed in a plain fenced block without a language tag.

## How to fix

Use forward slashes and relative paths, or put Windows-specific commands into a fenced block tagged with the Windows shell so the check knows they are intentional.

```markdown
Read `config/settings.json` relative to the project root.

```powershell
Get-Content C:\Projects\app\config\settings.json
```
```
