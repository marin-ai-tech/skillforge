# Codex

Codex reads skills and custom agents from its own folders. SkillForge installs skills unchanged, translates agents
into Codex TOML, and connects Codex to the registry over MCP without putting the token on the command line. This page
lists the Codex folders, what installs and how, and the Codex limits to know about.

## On this page

- [Folders](#folders)
- [What installs and how](#what-installs-and-how)
- [Install and sync](#install-and-sync)
- [Codex agents in TOML](#codex-agents-in-toml)
- [Installs from older versions under .agents](#installs-from-older-versions-under-agents)
- [Connect Codex over MCP](#connect-codex-over-mcp)
- [Scan the agent folder](#scan-the-agent-folder)
- [Known limits](#known-limits)
- [See also](#see-also)

## Folders

| | Value |
|---|---|
| `--runtime` | `codex` |
| Project folder | `.codex` in the current directory |
| User folder | `~/.codex` (`--scope user`) |
| Lock file | `.skillforge-lock.json` in that folder |

Support is verified against the real client in automated tests for skills and the MCP config. Agents have a known
limitation (see below).

## What installs and how

| Type | How it installs |
|---|---|
| `skill` | copied as is to `skills/<name>/` |
| `command` | not supported: "commands are not supported by codex (custom prompts are deprecated); publish it as a skill" |
| `agent` | translated to `agents/<name>.toml` |
| `hook` | not supported: "hooks are not supported by codex (its hooks use a different event and settings schema); install the hook in Claude Code with /plugin install" |
| `plugin` | not supported: "Claude Code plugins are not supported by codex; install the plugin in Claude Code with /plugin install" |
| `settings` | not supported: "settings profiles are not supported by codex (they target Claude Code settings.json)" |
| `mcp-server` | not installed yet; configure it in Codex by hand as the artifact page shows |

An unsupported type exits with code 1 and prints this reason; the Install tab shows the same reason instead of a
command.

## Install and sync

```bash
skillforge install skill/pdf-tools --runtime codex
skillforge install agent/code-reviewer --runtime codex --scope user
skillforge sync --runtime codex --status active --prune
skillforge outdated --runtime codex
```

`skillforge install skill/pdf-tools --runtime codex` writes `.codex/skills/pdf-tools/` and
`.codex/.skillforge-lock.json`.

The user scope is always `~/.codex`: SkillForge does not read `CODEX_HOME` when installing. If you set `CODEX_HOME`,
install skills with `--into` instead. `--into` copies files without translation, so use it for skills only:

```bash
skillforge install skill/pdf-tools --into "$CODEX_HOME"
```

## Codex agents in TOML

An agent is written as `agents/<name>.toml` with three keys:

| TOML key | From the registry agent |
|---|---|
| `name` | the artifact name |
| `description` | the `description` frontmatter field |
| `developer_instructions` | the markdown body, decoded back exactly as written |

Other frontmatter fields, such as `tools` or `model`, have no Codex equivalent. The CLI drops them and prints
`warning: agent <name>: dropped <fields> (not supported by codex)` to stderr.

## Installs from older versions under .agents

Older versions of `install --runtime codex` wrote skills under `.agents`. Those files still work, because Codex still
reads project `.agents/skills`, but their lock stays in `.agents`, so `sync --runtime codex` no longer sees them.
Manage them with `--into .agents`, or move them:

```bash
skillforge sync --into .agents
skillforge uninstall skill/pdf-tools --into .agents
skillforge install skill/pdf-tools --runtime codex
```

User-level installs that were under `~/.agents/skills` were never visible to Codex. Installing again with
`--runtime codex --scope user` places them in `~/.codex/skills`.

## Connect Codex over MCP

Create an MCP-enabled token on `/me/tokens` and pick Codex in the client switch. Codex does not accept custom
headers, so the token never appears in a Codex command.

The recommended way is stdio. The token comes from `skillforge login`, and the server address is passed with
`--env SKILLFORGE_URL`:

```bash
codex mcp add skillforge --env SKILLFORGE_URL=<server> -- skillforge mcp
```

Over HTTP, the entry reads the token from an environment variable. Set `SKILLFORGE_TOKEN=<token>` in the environment
Codex starts from:

```bash
codex mcp add skillforge --url <server>/mcp --bearer-token-env-var SKILLFORGE_TOKEN
```

## Scan the agent folder

```bash
skillforge agent scan --runtime codex --name laptop-codex
skillforge agent scan --runtime codex --name laptop-codex --mcp
```

Without a folder argument the scan reads `.codex`. Codex TOML agents and TOML commands are converted to markdown
agents and commands before they are parsed. An agent TOML needs `developer_instructions`; a `name` in the file must
pass the same name rule as everywhere else, and the file name is used only when `name` is absent. An agent the CLI
installed in TOML and that you did not change compares as `in_sync` or `outdated` through the lock file and shows
the hint "installed with translation".

With `--mcp`, the CLI also reads the Codex MCP config:

| Scope | File |
|---|---|
| project | `.codex/config.toml` in the current directory |
| user | `~/.codex/config.toml`, or `$CODEX_HOME/config.toml` when `CODEX_HOME` is set |

Only names, transport, package and pinned version, the remote origin and variable names are sent, never values.

## Known limits

- In a manual check, Codex 0.158 did not list agents installed by SkillForge. Check it on your Codex version before
  you rely on installed agents.
- Codex has no commands format SkillForge installs: publish the instructions as a skill.
- Installs ignore `CODEX_HOME`; use `--into "$CODEX_HOME"` for skills. The `--mcp` scan does honour `CODEX_HOME`.
- Hooks, plugins and settings profiles are Claude Code features and do not install into Codex.

## See also

- [Agent runtimes](README.md) for the comparison of all agents.
- [Agents and inventory](../12-agents-and-inventory.md) for snapshot statuses.
- [MCP](../13-mcp.md) for MCP tools and consent.
- In-app help: `getting-started/install`, `getting-started/mcp`, `getting-started/agent-support`.
