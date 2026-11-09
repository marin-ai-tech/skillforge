---
title: MCP connection snippets
summary: Shows copyable commands that connect your MCP client to SkillForge with a newly created MCP token. Use them right away, while the token secret is still on screen.
related: pages/tokens, getting-started/mcp, getting-started/cli, actions/tokens/mcp-client, getting-started/agent-support
---

## What it does

After you create an MCP-enabled token, shows copyable connect commands for HTTP (`…/mcp` with an Authorization header) and for the `skillforge mcp` stdio bridge so agents can attach in one step. A client switch picks the syntax for your client (Claude Code by default; [Agent support](getting-started/agent-support) lists the connect method of every runtime):

- Claude Code: `claude mcp add --transport http skillforge <server>/mcp --header "Authorization: Bearer <token>"` or `claude mcp add skillforge -- skillforge mcp`.
- Codex: `codex mcp add skillforge --url <server>/mcp --bearer-token-env-var SKILLFORGE_TOKEN` (the token is never in the command; set `SKILLFORGE_TOKEN` in the environment Codex starts from) or, recommended, `codex mcp add skillforge --env SKILLFORGE_URL=<server> -- skillforge mcp`.
- Cursor: JSON for the user-level `~/.cursor/mcp.json` with `url` and `headers`, or with `command` and `args` for stdio (recommended). Do not commit a token: keep it out of the project `.cursor/mcp.json`.
- OpenCode: `opencode mcp add skillforge --url <server>/mcp --header "Authorization=Bearer <token>"` or `opencode mcp add skillforge -- skillforge mcp`.
- Qwen Code: `qwen mcp add -s user -t http -H "Authorization: Bearer <token>" skillforge <server>/mcp` or `qwen mcp add -s user skillforge skillforge mcp`.

## When to use

Use immediately after token creation while the secret is still on screen. Paste into your agent config, then store the token in a vault—SkillForge will not show it again.

## Requires

An MCP-enabled token just created on `/me/tokens`. Ordinary tokens omit the snippet block. The stdio bridge needs the SkillForge CLI with a saved login (`skillforge login`).
