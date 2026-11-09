# Cursor

Cursor reads skills, commands and agents from its `.cursor` folders. SkillForge installs skills unchanged, writes
commands as plain bodies in the project only, and reduces agents to the fields Cursor reads. This page lists the
folders, the translation rules, the MCP connection through `~/.cursor/mcp.json`, and the Cursor limits.

## On this page

- [Folders](#folders)
- [What installs and how](#what-installs-and-how)
- [Install and sync](#install-and-sync)
- [Commands and agents for Cursor](#commands-and-agents-for-cursor)
- [Connect Cursor over MCP](#connect-cursor-over-mcp)
- [Scan the agent folder](#scan-the-agent-folder)
- [Known limits](#known-limits)
- [See also](#see-also)

## Folders

| | Value |
|---|---|
| `--runtime` | `cursor` |
| Project folder | `.cursor` in the current directory |
| User folder | `~/.cursor` (`--scope user`) |
| Lock file | `.skillforge-lock.json` in that folder |

Support is checked against the Cursor documentation only.

## What installs and how

| Type | How it installs |
|---|---|
| `skill` | copied as is to `skills/<name>/`, project or user scope |
| `command` | translated to `commands/<name>.md`, project scope only |
| `agent` | translated to `agents/<name>.md` |
| `hook` | not supported: "hooks are not supported by cursor (its hooks use a different event and settings schema); install the hook in Claude Code with /plugin install" |
| `plugin` | not supported: "Claude Code plugins are not supported by cursor; install the plugin in Claude Code with /plugin install" |
| `settings` | not supported: "settings profiles are not supported by cursor (they target Claude Code settings.json)" |
| `mcp-server` | not installed yet; configure it in Cursor by hand as the artifact page shows |

## Install and sync

```bash
skillforge install skill/pdf-tools --runtime cursor
skillforge install skill/pdf-tools --runtime cursor --scope user
skillforge install command/release-notes --runtime cursor
skillforge sync --runtime cursor --status active --prune
```

A command in the user scope exits with code 1: "commands are not supported by cursor in the user scope (Cursor
documents project commands only); use --scope project".

## Commands and agents for Cursor

| Type | File | Content |
|---|---|---|
| command | `commands/<name>.md` | the body only; the frontmatter is removed |
| agent | `agents/<name>.md` | frontmatter `name` and `description`, body unchanged |

Agent frontmatter fields other than `name` and `description`, such as `tools` or `model`, are dropped. The CLI
prints `warning: agent <name>: dropped <fields> (not supported by cursor)` to stderr.

## Connect Cursor over MCP

Cursor is configured with JSON in the user-level `~/.cursor/mcp.json`. Create an MCP-enabled token on `/me/tokens`
and pick Cursor in the client switch. The recommended entry is stdio, which keeps the token out of the file: the
`skillforge mcp` bridge uses the address and token saved by `skillforge login`.

```json
{
  "mcpServers": {
    "skillforge": { "command": "skillforge", "args": ["mcp"] }
  }
}
```

The HTTP entry puts the token into the file:

```json
{
  "mcpServers": {
    "skillforge": {
      "url": "<server>/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

> [!CAUTION]
> Do not commit a token: keep it out of the project `.cursor/mcp.json`.

## Scan the agent folder

```bash
skillforge agent scan --runtime cursor --name laptop-cursor
skillforge agent scan --runtime cursor --name laptop-cursor --mcp
```

Without a folder argument the scan reads `.cursor`. A Cursor agent file without `name` in its frontmatter takes its
name from the file name. An item the CLI installed with translation and that you did not change compares as
`in_sync` or `outdated` through the lock file.

With `--mcp`, the CLI also reads the Cursor MCP config:

| Scope | File |
|---|---|
| project | `.cursor/mcp.json` in the current directory |
| user | `~/.cursor/mcp.json` |

Only names, transport, package and pinned version, the remote origin and variable names are sent, never values. A
literal token in the file is reported as `literal secret: <names>`.

## Known limits

- Cursor support is checked against the documentation only, not against a running client.
- Commands install in the project scope only.
- Agents keep only `name` and `description`; other fields are dropped.
- Hooks, plugins and settings profiles are Claude Code features and do not install into Cursor.

## See also

- [Agent runtimes](README.md) for the comparison of all agents.
- [Agents and inventory](../12-agents-and-inventory.md) for MCP findings in snapshots.
- [MCP](../13-mcp.md) for MCP tools and consent.
- In-app help: `getting-started/agent-support`, `getting-started/mcp`.
