---
title: API tokens
summary: API tokens are personal Bearer secrets for the CLI, automation and MCP agents. Read this to create, use and revoke them safely.
section: ui-workspace
learn:
  - How to create a token and where to store the secret
  - How MCP tokens and tags limit agent access
  - How to connect MCP clients with the generated snippets
  - When and how to revoke a token
related: actions/tokens/create, actions/tokens/revoke, actions/tokens/mcp, actions/tokens/mcp-snippet, actions/tokens/mcp-client, getting-started/mcp, getting-started/cli
---

## What this page is for

The API tokens page lets a signed-in user create and revoke personal Bearer tokens for CLI and automation. Tokens look like `sf_<8 chars>_<32 chars>` and are shown only once at creation; the server stores a sha256 hash. Use tokens with `Authorization: Bearer <token>` on publish and other authenticated APIs. The token acts as you with your role (viewer cannot publish; contributor can). Revoked or unknown tokens return 401 unauthorized. Tokens owned by a disabled user also fail authentication.

> [!CAUTION]
> The secret is shown only once and cannot be retrieved later. Keep it in a password manager or CI secret store, never commit it, and revoke the token if the secret leaks.

## What you see

- List from `GET /api/v1/me/tokens`: id, name, prefix, created_at, last_used_at (never the full secret).
- Create form with a display name, optional MCP checkbox, and MCP tags field (enabled only when MCP is checked); response includes the one-time `token` string.
- For MCP tokens, a chip on each row (`MCP` or `MCP: tag1, tag2`) and connection snippets under the secret block, with a client switch per MCP client (see [Agent support](getting-started/agent-support)).
- Revoke action with a confirmation dialog before `DELETE /api/v1/me/tokens/:id`.
- Copy guidance for shell usage and a reminder that the secret cannot be retrieved later.
- Empty state when you have no tokens yet.

## Common tasks

1. Sign in and open API tokens from the user menu. Tokens are created only after you sign in: an API token cannot create other tokens (`403 session_required`), so revoking a token always ends its access.
2. Create a token named for its job (for example `ci-publish`).
3. Copy the `sf_…` secret immediately into a password manager or CI secret store.
4. Test with curl or the skillforge CLI using the Bearer header.
5. Watch `last_used_at` update after successful calls.
6. Revoke the token when the pipeline is retired or the secret leaked; confirm the dialog.

After you create a token, use it with the SkillForge CLI as described in [Using the CLI](getting-started/cli).

## MCP tokens

Check **Allow agents to load active skills via MCP** to mint a token that can call `POST /mcp`. Such a token works only for agents: on the REST API it may call just `GET /api/v1/me` and `GET /api/v1/health`; any other request returns `403 mcp_token_forbidden`, whatever your role. Use a regular token for the CLI's `install`, `sync` and `publish`. Optional comma-separated tags limit the agent to active artifacts that share a tag. The secret panel then includes connect snippets for HTTP and for the `skillforge mcp` stdio bridge. Pick your client with the switch (Claude Code by default):

- Claude Code: `claude mcp add --transport http skillforge <server>/mcp --header "Authorization: Bearer <token>"` or `claude mcp add skillforge -- skillforge mcp`.
- Codex: `codex mcp add skillforge --url <server>/mcp --bearer-token-env-var SKILLFORGE_TOKEN` with `SKILLFORGE_TOKEN` set in the environment Codex starts from, or (recommended) `codex mcp add skillforge --env SKILLFORGE_URL=<server> -- skillforge mcp`. The token never appears in a Codex command.
- Cursor: JSON for the user-level `~/.cursor/mcp.json` (stdio recommended). Do not commit a token: keep it out of the project `.cursor/mcp.json`.
- OpenCode: `opencode mcp add skillforge --url <server>/mcp --header "Authorization=Bearer <token>"` or `opencode mcp add skillforge -- skillforge mcp`.
- Qwen Code: `qwen mcp add -s user -t http -H "Authorization: Bearer <token>" skillforge <server>/mcp` or `qwen mcp add -s user skillforge skillforge mcp`.

 Agents see only `active` artifacts; revoke the token to cut access. Skill text remains untrusted prompt content—reviewer gate still applies before activation. See [MCP access for agents](getting-started/mcp).

## Permissions

Requires sign-in as any role; each user manages only their own tokens. Admin cannot read another user's raw token secret. Publishing with a token still requires the owner's role to be contributor or higher. No sign-in alternative exists for creating tokens—you must use a browser session first.
