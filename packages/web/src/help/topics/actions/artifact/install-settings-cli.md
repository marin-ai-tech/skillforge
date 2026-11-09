---
title: Install settings CLI command
summary: Shows the `skillforge settings apply` command, with the profile's scope, for a settings profile. Use it to apply an approved settings baseline to a machine or project.
related: getting-started/cli, pages/artifact, getting-started/artifact-types
---

## What it does

Shows and copies `skillforge settings apply settings/<name> --scope <scope>` for the current settings profile. The scope comes from the profile frontmatter (default `project`).

## When to use

Use when applying an approved company settings baseline to a developer machine or project. Prefer `--dry-run` first to preview merges. Do not use marketplace `/plugin install` for settings profiles.

## Requires

CLI access to the registry URL; sign-in when public read is disabled. Applying settings writes under the chosen Claude Code settings path on the local machine.
