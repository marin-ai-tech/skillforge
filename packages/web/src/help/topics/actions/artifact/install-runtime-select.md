---
title: Install runtime selector
summary: Chooses which agent runtime the install command on the Install tab targets. Use it to install for a specific agent or to check whether a type has an equivalent there.
related: getting-started/install, getting-started/cli, pages/artifact, getting-started/agent-support
---

## What it does

Chooses the agent runtime for the install command on the Install tab (Claude Code by default). The list and its order come from the server runtime table (`GET /api/v1/runtimes`; [Agent support](getting-started/agent-support) shows what each runtime supports), and the command or the reason below updates as soon as you change the selection.

## When to use

Use when the artifact should run in a specific agent runtime, or when you want to check whether a type (command, agent, hook) has an equivalent in that agent before installing it with the SkillForge CLI.

## Requires

The artifact must be `active`; for other statuses the selector is hidden and only direct downloads remain. Running the command needs the SkillForge CLI and access to the registry URL.
