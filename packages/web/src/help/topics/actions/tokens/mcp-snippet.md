---
title: MCP connection snippets
summary: Shows copyable commands that connect your MCP client to SkillForge with a newly created MCP token. Use them right away, while the token secret is still on screen.
related: pages/tokens, getting-started/mcp, getting-started/cli, actions/tokens/mcp-client, getting-started/agent-support
---

## What it does

After you create an MCP-enabled token, shows copyable connect commands (for Claude Code, Cursor and Qwen Code, JSON blocks) for HTTP (`…/mcp` with an Authorization header) and for the `skillforge mcp` stdio bridge so agents can attach in one step. A client switch picks the syntax for your client (Claude Code by default; [Agent support](getting-started/agent-support) lists the connect method of every runtime):

- Claude Code: a block for the project `.mcp.json` with `"Authorization": "Bearer ${SKILLFORGE_MCP_TOKEN}"` (set `SKILLFORGE_MCP_TOKEN` in the environment Claude Code starts from; the token is never in the file) or, recommended, `claude mcp add skillforge -- skillforge mcp`. An entry made by the former `claude mcp add --transport http` command keeps the token in `~/.claude.json`: remove it with `claude mcp remove skillforge`.
- Codex: `codex mcp add skillforge --url <server>/mcp --bearer-token-env-var SKILLFORGE_MCP_TOKEN` with `SKILLFORGE_MCP_TOKEN` set to the MCP token in the environment Codex starts from (`config.toml` keeps only the variable name), or (recommended) `codex mcp add skillforge --env SKILLFORGE_URL=<server> -- skillforge mcp`. An entry made by the former command reads another variable: run the command again.
- Cursor: JSON for the user-level `~/.cursor/mcp.json` with `"Authorization": "Bearer ${env:SKILLFORGE_MCP_TOKEN}"` (set the variable in the environment Cursor starts from), or with `command` and `args` for stdio (recommended). An entry with the token itself in the header: replace the token with `${env:SKILLFORGE_MCP_TOKEN}`.
- OpenCode: `opencode mcp add skillforge --url <server>/mcp --header "Authorization=Bearer {env:SKILLFORGE_MCP_TOKEN}"` (set the variable in the environment OpenCode starts from; running the command again replaces an entry made by the former command) or `opencode mcp add skillforge -- skillforge mcp`.
- Qwen Code: a block for `mcpServers` in the user-level `~/.qwen/settings.json` with `"httpUrl": "<server>/mcp"` and `"Authorization": "Bearer ${SKILLFORGE_MCP_TOKEN}"` (set the variable in the environment Qwen Code starts from), or `qwen mcp add -s user skillforge skillforge mcp`. An entry made by the former `qwen mcp add -t http` command keeps the token: remove it first with `qwen mcp remove -s user skillforge`.

## When to use

Use immediately after token creation while the secret is still on screen. Paste the snippet into your agent config, set `SKILLFORGE_MCP_TOKEN` to the token in the environment the agent starts from, then store the token in a vault—SkillForge will not show it again.

## Requires

An MCP-enabled token just created on `/me/tokens`. Ordinary tokens omit the snippet block. The stdio bridge needs the SkillForge CLI with the MCP token saved once: `skillforge login --url <server> --mcp-token-stdin`. The token of a regular login is refused with `403 mcp_not_allowed`.
