---
title: Settings recommended scope
summary: Shows the Claude Code settings scope (user, project, or local) that a settings profile recommends. Use it to decide where a baseline belongs before applying it.
related: getting-started/artifact-types, pages/artifact, getting-started/cli
---

## What it does

Shows the profile's recommended Claude Code settings scope from `SETTINGS.md` frontmatter: `user` (`~/.claude/settings.json`), `project` (`.claude/settings.json`), or `local` (`.claude/settings.local.json`). The Install CLI command includes this scope by default.

## When to use

Use when deciding whether a baseline belongs on every machine, one repository, or a personal override. Override with `--scope` on the CLI when needed.

## Requires

Viewer access to the artifact Overview. Applying the profile still requires local CLI access to write the target file.
