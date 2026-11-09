---
title: Install runtime command
summary: Shows the install command for the selected runtime, usually `skillforge install` with `--runtime`. Use it to install an approved artifact into a project for a specific agent.
related: getting-started/install, getting-started/cli, pages/artifact, getting-started/agent-support
---

## What it does

Shows and copies the install command for the selected runtime. Files and translated commands or agents use `skillforge install <type>/<name> --runtime <id>`: the CLI writes into that agent's directory and translates commands and agents to its format (trimmed keys are listed in a warning); see [Agent support](getting-started/agent-support) for what each runtime accepts. For hooks and plugins the Claude Code row shows `/plugin install <plugin>@<marketplace>`: Claude Code is the one agent with a plugin marketplace. Settings profiles target Claude Code settings and show `skillforge settings apply`. An `mcp-server` has no install command yet: every row explains that the server is configured in the agent by hand.

## When to use

Use when installing an approved artifact into a project for a specific agent. Add `--scope user` to install into the agent's home directory instead of the project, where the runtime supports it.

## Requires

The SkillForge CLI, the registry URL, and sign-in when public read is disabled. The install writes a `.skillforge-lock.json` into the runtime directory.
