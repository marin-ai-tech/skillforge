# Qwen Code

Qwen Code reads skills, commands and agents from its `.qwen` folders. SkillForge installs skills and agents
unchanged and adapts the argument placeholder of commands. This page lists the folders, the command translation, the
MCP connection in the user scope, and the limits.

## On this page

- [Folders](#folders)
- [What installs and how](#what-installs-and-how)
- [Install and sync](#install-and-sync)
- [Commands for Qwen Code](#commands-for-qwen-code)
- [Connect Qwen Code over MCP](#connect-qwen-code-over-mcp)
- [Scan the agent folder](#scan-the-agent-folder)
- [Known limits](#known-limits)
- [See also](#see-also)

## Folders

| | Value |
|---|---|
| `--runtime` | `qwen` |
| Project folder | `.qwen` in the current directory |
| User folder | `~/.qwen` (`--scope user`) |
| Lock file | `.skillforge-lock.json` in that folder |

Support is verified against the real client in automated tests.

## What installs and how

| Type | How it installs |
|---|---|
| `skill` | copied as is to `skills/<name>/` |
| `command` | translated to `commands/<name>.md` |
| `agent` | copied as is to `agents/<name>.md` |
| `hook` | not supported: "hooks are not supported by qwen (its hooks use a different event and settings schema); install the hook in Claude Code with /plugin install" |
| `plugin` | not supported: "Claude Code plugins are not supported by qwen; install the plugin in Claude Code with /plugin install" |
| `settings` | not supported: "settings profiles are not supported by qwen (they target Claude Code settings.json)" |
| `mcp-server` | not installed yet; configure it in Qwen Code by hand as the artifact page shows |

## Install and sync

```bash
skillforge install skill/pdf-tools --runtime qwen
skillforge install command/release-notes --runtime qwen --scope user
skillforge sync --runtime qwen --status active --prune
skillforge outdated --runtime qwen
```

## Commands for Qwen Code

A command becomes `commands/<name>.md`:

- the frontmatter is reduced to `description` (omitted when there is none);
- `$ARGUMENTS` in the body is replaced by `{{args}}`;
- the rest of the body is unchanged.

Positional arguments `$1` to `$9` have no Qwen Code equivalent. They are kept as is, and the CLI prints
`warning: command <name>: positional arguments … have no Qwen Code equivalent and are kept as is; use {{args}}` to
stderr.

## Connect Qwen Code over MCP

Create an MCP-enabled token on `/me/tokens` and pick Qwen Code in the client switch. Both commands add the server in
the user scope (`-s user`):

```bash
qwen mcp add -s user -t http -H "Authorization: Bearer <token>" skillforge <server>/mcp
qwen mcp add -s user skillforge skillforge mcp
```

The second command runs the `skillforge mcp` stdio bridge, which uses the address and token saved by
`skillforge login`.

## Scan the agent folder

```bash
skillforge agent scan --runtime qwen --name laptop-qwen
```

Without a folder argument the scan reads `.qwen`. When the runtime is `qwen`, `{{args}}` in a command is turned back
into `$ARGUMENTS` before parsing, so a command the CLI installed compares with the registry version. An untouched
translated install compares as `in_sync` or `outdated` through the lock file and shows "installed with
translation".

`--mcp` is not supported for Qwen Code: `skillforge agent scan --runtime qwen --mcp` exits with code 1 and lists the
runtimes whose MCP configs are read (Claude Code, Codex, Cursor and OpenCode).

## Known limits

- Positional command arguments are not translated.
- The MCP server configs of Qwen Code are not read by `agent scan --mcp`, so its MCP servers do not appear in the
  organisation inventory.
- Hooks, plugins and settings profiles are Claude Code features and do not install into Qwen Code.

## See also

- [Agent runtimes](README.md) for the comparison of all agents.
- [MCP](../13-mcp.md) for MCP tools and consent.
- In-app help: `getting-started/agent-support`, `getting-started/mcp`.
