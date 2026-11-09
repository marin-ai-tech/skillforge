# Gemini CLI

Gemini CLI reads skills and custom commands from its `.gemini` folders. SkillForge installs skills unchanged and
translates commands into Gemini CLI TOML; Gemini CLI has no subagent format SkillForge installs. This page lists the
folders, the translation rules, how Gemini CLI reaches the registry over MCP, and the limits.

## On this page

- [Folders](#folders)
- [What installs and how](#what-installs-and-how)
- [Install and sync](#install-and-sync)
- [Commands in TOML](#commands-in-toml)
- [Connect Gemini CLI over MCP](#connect-gemini-cli-over-mcp)
- [Scan the agent folder](#scan-the-agent-folder)
- [Known limits](#known-limits)
- [See also](#see-also)

## Folders

| | Value |
|---|---|
| `--runtime` | `gemini` |
| Project folder | `.gemini` in the current directory |
| User folder | `~/.gemini` (`--scope user`) |
| Lock file | `.skillforge-lock.json` in that folder |

Support is checked against the Gemini CLI documentation.

## What installs and how

| Type | How it installs |
|---|---|
| `skill` | copied as is to `skills/<name>/` |
| `command` | translated to `commands/<name>.toml` |
| `agent` | not supported: "agents are not supported by gemini (it has no subagent format SkillForge installs); publish the instructions as a skill" |
| `hook` | not supported: "hooks are not supported by gemini (its hooks use a different event and settings schema); install the hook in Claude Code with /plugin install" |
| `plugin` | not supported: "Claude Code plugins are not supported by gemini; install the plugin in Claude Code with /plugin install" |
| `settings` | not supported: "settings profiles are not supported by gemini (they target Claude Code settings.json)" |
| `mcp-server` | not installed yet; configure it in Gemini CLI by hand as the artifact page shows |

## Install and sync

```bash
skillforge install skill/pdf-tools --runtime gemini
skillforge install command/release-notes --runtime gemini --scope user
skillforge sync --runtime gemini --status active --prune
skillforge outdated --runtime gemini
```

## Commands in TOML

A command becomes `commands/<name>.toml`:

| TOML key | From the registry command |
|---|---|
| `description` | the `description` frontmatter field, when there is one |
| `prompt` | the markdown body, with `$ARGUMENTS` replaced by `{{args}}` |

Positional arguments `$1` to `$9` have no Gemini CLI equivalent. They are kept as is, and the CLI prints
`warning: command <name>: positional arguments $1, $2 have no Gemini CLI equivalent and are kept as is; use {{args}}`
to stderr. Write the command with `$ARGUMENTS` if it must work in Gemini CLI.

## Connect Gemini CLI over MCP

The API tokens page has no ready-made Gemini CLI snippet. Gemini CLI connects like any MCP client: over HTTP to
`<server>/mcp` with the header `Authorization: Bearer <token>`, using a token created on `/me/tokens` with **Allow
agents to load active skills via MCP**. Add that endpoint in the way the Gemini CLI documentation describes. The agent
then sees only `active` artifacts, narrowed by the token's MCP tags.

## Scan the agent folder

```bash
skillforge agent scan --runtime gemini --name laptop-gemini
```

Without a folder argument the scan reads `.gemini`. TOML commands are converted back to markdown before they are
parsed: `prompt` becomes the body with `{{args}}` turned back into `$ARGUMENTS`, and `description` becomes the
frontmatter. A TOML command without `prompt` is reported as invalid. A command the CLI installed and that you did
not change compares as `in_sync` or `outdated` through the lock file and shows "installed with translation".

`--mcp` is not supported for Gemini CLI: `skillforge agent scan --runtime gemini --mcp` exits with code 1 and lists
the runtimes whose MCP configs are read (Claude Code, Codex, Cursor and OpenCode).

## Known limits

- Support is checked against the documentation only, not against a running client.
- Agents do not install; publish agent instructions as a skill.
- Positional command arguments are not translated.
- The MCP server configs of Gemini CLI are not read by `agent scan --mcp`.
- Hooks, plugins and settings profiles are Claude Code features and do not install into Gemini CLI.

## See also

- [Agent runtimes](README.md) for the comparison of all agents.
- [MCP](../13-mcp.md) for MCP tools and consent.
- In-app help: `getting-started/agent-support`, `getting-started/install`.
