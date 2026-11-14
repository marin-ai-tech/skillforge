# OpenCode

OpenCode reads skills, commands and agents from `.opencode` in a project and from `~/.config/opencode` for the user.
SkillForge installs skills unchanged and translates commands and agents into the frontmatter OpenCode accepts. This
page lists the folders, the translation rules, the MCP connection and the MCP configs that `agent scan --mcp` reads.

## On this page

- [Folders](#folders)
- [What installs and how](#what-installs-and-how)
- [Install and sync](#install-and-sync)
- [Commands and agents for OpenCode](#commands-and-agents-for-opencode)
- [Connect OpenCode over MCP](#connect-opencode-over-mcp)
- [Scan the agent folder](#scan-the-agent-folder)
- [Known limits](#known-limits)
- [See also](#see-also)

## Folders

| | Value |
|---|---|
| `--runtime` | `opencode` |
| Project folder | `.opencode` in the current directory |
| User folder | `~/.config/opencode` (`--scope user`) |
| Lock file | `.skillforge-lock.json` in that folder |

Support is verified against the real client in automated tests.

## What installs and how

| Type | How it installs |
|---|---|
| `skill` | copied as is to `skills/<name>/` |
| `command` | translated to `commands/<name>.md` |
| `agent` | translated to `agents/<name>.md` as a subagent |
| `hook` | not supported: "hooks are not supported by opencode (its hooks use a different event and settings schema); install the hook in Claude Code with /plugin install" |
| `plugin` | not supported: "Claude Code plugins are not supported by opencode; install the plugin in Claude Code with /plugin install" |
| `settings` | not supported: "settings profiles are not supported by opencode (they target Claude Code settings.json)" |
| `mcp-server` | not installed yet; configure it in OpenCode by hand as the artifact page shows |
| `rule` | copied as is to `rules/<name>.md`, project scope only; the line `.opencode/rules/*.md` is added once to `instructions` of the project's OpenCode config, so OpenCode loads the rules on every turn (it has no path rules) |

## Install and sync

```bash
skillforge install skill/pdf-tools --runtime opencode
skillforge install agent/code-reviewer --runtime opencode --scope user
skillforge sync --runtime opencode --status active --prune
skillforge outdated --runtime opencode
```

## Commands and agents for OpenCode

| Type | File | Frontmatter | Body |
|---|---|---|---|
| command | `commands/<name>.md` | only `description` (omitted when there is none) | unchanged |
| agent | `agents/<name>.md` | exactly `description` and `mode: subagent` | unchanged |

OpenCode takes the agent name from the file name. Other agent fields are dropped on purpose, because OpenCode rejects
its whole configuration when it meets Claude Code values of `color` or `tools`. The CLI prints
`warning: agent <name>: dropped <fields> (not supported by opencode)` to stderr.

## Connect OpenCode over MCP

Create an MCP-enabled token on `/me/tokens` and pick OpenCode in the client switch:

```bash
opencode mcp add skillforge --url <server>/mcp --header "Authorization=Bearer <token>"
opencode mcp add skillforge -- skillforge mcp
```

The second command runs the `skillforge mcp` stdio bridge, which uses the address and token saved by
`skillforge login`. Note the `Authorization=Bearer` form of the header that OpenCode expects.

## Scan the agent folder

```bash
skillforge agent scan --runtime opencode --name laptop-opencode
skillforge agent scan --runtime opencode --name laptop-opencode --mcp
```

Without a folder argument the scan reads `.opencode`. An agent file without `name` in its frontmatter takes its name
from the file name. An item the CLI installed with translation and that you did not change compares as `in_sync` or
`outdated` through the lock file and shows "installed with translation".

With `--mcp`, the CLI also reads every OpenCode config it finds:

| Scope | Files |
|---|---|
| project | `opencode.json`, `opencode.jsonc`, `.opencode/opencode.json`, `.opencode/opencode.jsonc` in the current directory |
| user | `~/.config/opencode/opencode.json`, `~/.config/opencode/opencode.jsonc` |

Comments in `.jsonc` files are allowed. Only names, transport, package and pinned version, the remote origin and
variable names are sent, never values.

## Known limits

- Agents always install as subagents with only `description` kept.
- The user folder is `~/.config/opencode`, not `~/.opencode`.
- Hooks, plugins and settings profiles are Claude Code features and do not install into OpenCode.

## See also

- [Agent runtimes](README.md) for the comparison of all agents.
- [Agents and inventory](../12-agents-and-inventory.md) for snapshot statuses and MCP findings.
- [MCP](../13-mcp.md) for MCP tools and consent.
- In-app help: `getting-started/agent-support`, `getting-started/mcp`.
