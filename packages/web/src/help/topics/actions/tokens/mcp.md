---
title: Allow MCP on a token
summary: Allows a new API token to be used by MCP clients, optionally limited to tags. Use it to connect an agent to SkillForge for read-only search of active skills.
related: pages/tokens, getting-started/mcp, actions/tokens/mcp-snippet
---

## What it does

Enables the `mcp` flag (and optional `mcp_tags`) when creating an API token so agents may call `POST /mcp` with that Bearer secret. Tags are kebab-case, at most ten entries, each up to 32 characters; tags without `mcp: true` are rejected by the API.

## When to use

Use when connecting any MCP client to SkillForge for read-only search of active skills. Prefer a dedicated agent token instead of reusing a CI publish token.

## Requires

Sign-in as any role that can manage its own tokens.

> [!NOTE]
> MCP consent cannot be changed later—create a new token to adjust tags.
