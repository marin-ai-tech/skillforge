---
title: Choose an MCP client
summary: Switches the connection snippets for a new MCP token between the supported MCP clients. Use it to get the command for the agent you actually run.
related: actions/tokens/mcp-snippet, getting-started/mcp, pages/tokens, getting-started/agent-support
---

## What it does

Switches the connection snippets under a new MCP token between the supported MCP clients (see [Agent support](getting-started/agent-support)). Each client has its own syntax, so the HTTP and stdio commands (or the Cursor JSON) and the notes under them change with the choice. Claude Code is selected by default; your last choice is remembered in this browser.

## When to use

Use right after creating an MCP-enabled token, before you copy a command. Pick the client you actually run so the command matches its `mcp add` syntax.

## Requires

An MCP-enabled token just created on `/me/tokens`. The choice is stored in browser storage only as a convenience; if storage is blocked, the switch still works and falls back to Claude Code next time.
