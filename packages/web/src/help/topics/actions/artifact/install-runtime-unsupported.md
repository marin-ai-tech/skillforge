---
title: Runtime not supported
summary: Explains why the selected runtime cannot install this artifact type, instead of offering a command that would not work. Read it to find the alternative, such as publishing the content as a skill.
related: getting-started/install, getting-started/cli, pages/artifact, getting-started/agent-support
---

## What it does

Explains why the selected runtime cannot install this artifact type, instead of offering a command that would write files the agent never reads. Examples: a runtime without slash commands (publish the text as a skill instead), a runtime without a subagent format SkillForge installs, hooks and plugins (installed through the Claude Code marketplace), settings profiles (applied with `skillforge settings apply`) and MCP servers (`mcp-server`: SkillForge does not install them into agents yet, configure the server in the agent by hand). [Agent support](getting-started/agent-support) lists what each runtime supports.

## When to use

Read it when choosing a runtime for a command, agent, hook, plugin, settings profile or MCP server. The CLI gives the same reason and exits with code 1, and `skillforge sync` lists such artifacts under `skipped`.

## Requires

Nothing to run: it is informational. To reach that runtime anyway, publish the content as a skill, which every runtime supports.
