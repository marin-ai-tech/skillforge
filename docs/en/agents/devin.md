# Devin

Devin reads project skills from `.agents/skills`. SkillForge installs skills there unchanged; Devin has no user
folder and no commands or agents format that SkillForge installs. This page lists the folder, what installs, how
Devin reaches the registry over MCP, and the limits.

## On this page

- [Folders](#folders)
- [What installs and how](#what-installs-and-how)
- [Install and sync](#install-and-sync)
- [Connect Devin over MCP](#connect-devin-over-mcp)
- [Scan the agent folder](#scan-the-agent-folder)
- [Known limits](#known-limits)
- [See also](#see-also)

## Folders

| | Value |
|---|---|
| `--runtime` | `devin` |
| Project folder | `.agents` in the current directory |
| User folder | none |
| Lock file | `.agents/.skillforge-lock.json` |

Support is checked against the Devin documentation.

## What installs and how

| Type | How it installs |
|---|---|
| `skill` | copied as is to `.agents/skills/<name>/` |
| `command` | not supported: "commands are not supported by devin; publish it as a skill" |
| `agent` | not supported: "agents are not supported by devin (it has no subagent format SkillForge installs); publish the instructions as a skill" |
| `hook` | not supported: "hooks are not supported by devin (its hooks use a different event and settings schema); install the hook in Claude Code with /plugin install" |
| `plugin` | not supported: "Claude Code plugins are not supported by devin; install the plugin in Claude Code with /plugin install" |
| `settings` | not supported: "settings profiles are not supported by devin (they target Claude Code settings.json)" |
| `mcp-server` | not installed yet; configure it in Devin by hand as the artifact page shows |

## Install and sync

```bash
skillforge install skill/pdf-tools --runtime devin
skillforge sync --runtime devin --type skill --status active --prune
skillforge outdated --runtime devin
```

`--scope user` is refused with exit code 1: "the user scope is not supported by devin (no user-level directory); use
--scope project".

Codex also reads project `.agents/skills`, so a skill installed for Devin in a project is visible to Codex there too.
The two runtimes keep separate locks: `sync --runtime devin` manages `.agents`, and `sync --runtime codex` manages
`.codex`.

## Connect Devin over MCP

The API tokens page has no ready-made Devin snippet. Devin connects like any MCP client: over HTTP to
`<server>/mcp` with the header `Authorization: Bearer <token>`, using a token created on `/me/tokens` with **Allow
agents to load active skills via MCP**. The agent then sees only `active` artifacts, narrowed by the token's MCP tags.
Revoke the token on the same page to cut access.

## Scan the agent folder

```bash
skillforge agent scan --runtime devin --name devin-project
```

Without a folder argument the scan reads `.agents`. Skill folders with `SKILL.md` are found and compared with the
registry; other files stay on your machine.

`--mcp` is not supported for Devin: `skillforge agent scan --runtime devin --mcp` exits with code 1 and lists the
runtimes whose MCP configs are read (Claude Code, Codex, Cursor and OpenCode).

## Known limits

- Skills only, in the project scope only.
- Support is checked against the documentation only, not against a running client.
- No MCP config of Devin is read by `agent scan --mcp`.
- Publish command or agent instructions as a skill if Devin must use them.

## See also

- [Agent runtimes](README.md) for the comparison of all agents.
- [Codex](codex.md) for Codex and the shared `.agents/skills` folder.
- [MCP](../13-mcp.md) for MCP tools and consent.
- In-app help: `getting-started/agent-support`, `getting-started/install`.
