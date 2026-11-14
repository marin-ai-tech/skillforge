---
title: MCP access for agents
summary: How coding agents read approved artifacts over the Model Context Protocol, and the consent and safety limits that keep drafts hidden.
section: start
learn:
  - What the five MCP tools do
  - How token consent and MCP tags limit what an agent sees
  - How to connect Claude Code, Codex, Cursor, OpenCode and Qwen Code
  - How to revoke access and why skill text is untrusted
related: pages/tokens, actions/tokens/mcp, actions/tokens/mcp-snippet, actions/tokens/mcp-client, getting-started/cli, getting-started/lifecycle, getting-started/agent-support
---

Model Context Protocol (MCP) lets coding agents talk to SkillForge over JSON-RPC 2.0. Instead of scraping the catalog UI, an agent calls `POST /mcp` (or the `skillforge mcp` stdio bridge) to search approved artifacts and read their files. This page explains consent, visibility, how to connect, and the safety limits that keep candidate drafts hidden.

## What MCP access means

SkillForge exposes five tools on the MCP endpoint: `search_artifacts`, `get_artifact`, `read_artifact_file`, `read_artifact_files`, and `record_usage`. The first four only read; `read_artifact_files` returns every file of a version in one call, each in the same form as `read_artifact_file`, and lists in `omitted` the files it did not send (`too_large` over 4 MiB, `budget` past 8 MiB in one answer, `missing`) so they can be read one by one; `record_usage` reports how often an artifact was applied and helped, optionally with `basis`: `loaded` or `assigned` (the latter is shown separately and not counted) (fields it does not know, such as an `event` payload, are ignored). Agents cannot publish, change lifecycle status, or install files on their own machine through MCP—that remains the job of `skillforge install` and the web UI. An MCP token sees no more over REST than through MCP: apart from `GET /api/v1/me` and `GET /api/v1/health`, the REST API refuses it with `403 mcp_token_forbidden`. Every MCP request must carry `Authorization: Bearer <token>`; browser cookies are ignored so a random page cannot drive MCP on your behalf. Requests that include an `Origin` header are rejected to block DNS-rebinding attacks from a browser context. This topic is about SkillForge as an MCP server for your agent; other MCP servers your company approves are artifacts of type `mcp-server` in the catalog ([Artifact types](getting-started/artifact-types)).

## Consent through tokens and tags

> [!IMPORTANT]
> MCP is off by default. When you create an API token on `/me/tokens`, enable **Allow agents to load active skills via MCP**.

Optionally add up to ten kebab-case `mcp_tags` (each at most 32 characters). Those tags narrow visibility: the agent only sees `active` artifacts that share at least one tag. Leave tags empty to expose every active artifact. Consent is fixed at creation—rotate the token if you need a different policy. Revoking the token immediately cuts agent access.

## What the agent can see

Only artifacts in status `active` are visible, matching `marketplace.json`. Candidate, aging, retired, and zombie items look like "not found" so agents cannot probe unpublished drafts. Path arguments to `read_artifact_file` must match a version file path exactly—no `..`, backslashes, or normalization tricks. `get_artifact` lists every file with its `sha256` and a `binary` flag, and gives the version `digest`, so a client can verify what it received against the registry. `read_artifact_file` returns UTF-8 text up to 256 KiB as `encoding: "utf-8"`; any other file up to 4 MiB comes as `encoding: "base64"` in `content_base64`; larger files return a tool error with the limit.

## Connecting over HTTP and stdio

After you create an MCP-enabled token, the tokens page shows two snippets: one for Streamable HTTP and one for the `skillforge mcp` stdio bridge (URL and token from `skillforge login` config or flags). A client switch above them picks the client (Claude Code by default); your choice is remembered in the browser. [Agent support](getting-started/agent-support) shows the connect method of every runtime; any other MCP client connects over HTTP `<server>/mcp` with `Authorization: Bearer`.

Claude Code:

- HTTP: `claude mcp add --transport http skillforge <server>/mcp --header "Authorization: Bearer <token>"`
- stdio: `claude mcp add skillforge -- skillforge mcp`

Codex never takes the token on its command line, because it does not accept custom headers. The HTTP entry reads the token from an environment variable: set `SKILLFORGE_TOKEN=<token>` in the environment Codex starts from. The recommended option for Codex is stdio: the token comes from `skillforge login` and the server URL is passed with `--env SKILLFORGE_URL`.

- HTTP: `codex mcp add skillforge --url <server>/mcp --bearer-token-env-var SKILLFORGE_TOKEN`
- stdio (recommended): `codex mcp add skillforge --env SKILLFORGE_URL=<server> -- skillforge mcp`

Cursor is configured with JSON in the user-level `~/.cursor/mcp.json`. The stdio entry (recommended) keeps the token out of the file entirely.

> [!CAUTION]
> Do not commit a token: keep it out of the project `.cursor/mcp.json`.

- HTTP: `{"mcpServers":{"skillforge":{"url":"<server>/mcp","headers":{"Authorization":"Bearer <token>"}}}}`
- stdio (recommended): `{"mcpServers":{"skillforge":{"command":"skillforge","args":["mcp"]}}}`

OpenCode:

- HTTP: `opencode mcp add skillforge --url <server>/mcp --header "Authorization=Bearer <token>"`
- stdio: `opencode mcp add skillforge -- skillforge mcp`

Qwen Code (user scope):

- HTTP: `qwen mcp add -s user -t http -H "Authorization: Bearer <token>" skillforge <server>/mcp`
- stdio: `qwen mcp add -s user skillforge skillforge mcp`

The commands use only double quotes, so they paste the same way into cmd.exe, PowerShell, bash and zsh.

The bridge reads JSON-RPC lines from stdin, posts each to `/mcp`, writes `200` responses to stdout, and stays silent on `202` notifications. Missing URL exits with code 3; missing token exits with code 4.

## Revoking access and content risk

Revoke a token from the same page when a laptop is lost or a CI job ends. Rely on the reviewer gate before promotion to `active`, keep MCP tags tight for sensitive teams, and prefer short-lived tokens for experiments. Pair this topic with [API tokens](pages/tokens) and [Using the CLI](getting-started/cli) when you wire agents into a self-hosted registry.

> [!WARNING]
> Treat skill bodies as untrusted text inside the agent prompt: a malicious or sloppy skill can inject instructions.