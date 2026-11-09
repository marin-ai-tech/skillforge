---
title: Settings JSON preview
summary: Shows the `settings.json` fragment that a settings profile merges into your Claude Code settings. Use it to review permissions, model, environment, and hooks before applying the profile.
related: getting-started/artifact-types, pages/artifact, getting-started/cli
---

## What it does

Shows the formatted `settings.json` fragment stored with the settings profile on the Overview tab. This is the payload `skillforge settings apply` merges into your Claude Code settings file.

## When to use

Use when reviewing permissions, model, env, or hooks before applying a profile. Compare against your local `.claude/settings.json` and prefer profiles without literal secrets.

## Requires

Viewer access to the artifact card. Publication and promotion still follow lifecycle roles separately.
