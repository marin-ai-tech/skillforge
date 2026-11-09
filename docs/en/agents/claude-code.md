# Claude Code

Claude Code is the reference runtime of SkillForge: the registry stores commands and agents in Claude Code markdown,
and hooks, plugins and settings profiles are Claude Code features. This page shows where SkillForge writes files for
Claude Code, how to use the SkillForge plugin marketplace and settings profiles, and how to connect Claude Code to the
registry over MCP.

## On this page

- [Folders](#folders)
- [What installs and how](#what-installs-and-how)
- [Install and sync with the CLI](#install-and-sync-with-the-cli)
- [Install through the plugin marketplace](#install-through-the-plugin-marketplace)
- [Apply a settings profile](#apply-a-settings-profile)
- [Connect Claude Code over MCP](#connect-claude-code-over-mcp)
- [Scan the agent folder](#scan-the-agent-folder)
- [Other Claude Code features](#other-claude-code-features)
- [Known limits](#known-limits)
- [See also](#see-also)

## Folders

| | Value |
|---|---|
| `--runtime` | `claude-code` (the default when you pass neither `--runtime` nor `--into`) |
| Project folder | `.claude` in the current directory |
| User folder | `~/.claude` (`--scope user`) |
| Lock file | `.skillforge-lock.json` in that folder |

Support is verified against the real client: the marketplace, MCP and settings.

## What installs and how

| Type | How it installs |
|---|---|
| `skill` | copied as is to `skills/<name>/` |
| `command` | copied as is to `commands/<name>.md` |
| `agent` | copied as is to `agents/<name>.md` |
| `hook` | only through the plugin marketplace (`/plugin install`) |
| `plugin` | only through the plugin marketplace (`/plugin install`) |
| `settings` | merged into a Claude Code settings file with `skillforge settings apply` |
| `mcp-server` | not installed: "an MCP server is not installed by SkillForge yet (planned); configure it in claude-code by hand as the artifact page shows" |

## Install and sync with the CLI

```bash
skillforge install skill/pdf-tools
skillforge install agent/code-reviewer --scope user
skillforge sync --status active --prune
skillforge outdated
skillforge uninstall skill/pdf-tools
```

Without flags the CLI writes into `.claude` in the current directory, which is the same as
`--runtime claude-code --scope project`. The Install tab of an active artifact shows the same command for Claude Code
in the runtime selector.

`install` of a hook or a plugin exits with code 1 and prints the `/plugin install <plugin>@<marketplace>` command,
because the CLI never unpacks them. `sync` does not fail on them: it lists them as skipped and exits 0.

## Install through the plugin marketplace

Only Claude Code has a plugin marketplace, and SkillForge can act as one. In Claude Code, any active artifact can be
installed this way; hooks and plugins can be installed only this way. Add the registry once:

```text
/plugin marketplace add <SKILLFORGE_BASE_URL>/marketplace.json
```

The same command is on the Home page and on the Install tab of each artifact. Then install an approved plugin:

```text
/plugin install <plugin>@<marketplace>
```

- The marketplace name defaults to `skillforge` (the operator can change it with `SKILLFORGE_MARKETPLACE_NAME`).
- Skills keep their artifact name as the plugin name. Commands, agents and hooks get the type appended, for example
  `propose-command`, `code-reviewer-agent` or `destructive-guard-hook`. The Install tab shows the exact command.
- Only `active` artifacts are listed by default. `marketplace.json?status=candidate,active` lists candidates too.
- Settings profiles and MCP servers are not marketplace plugins.

Claude Code 2.1.288 or newer fetches each plugin from the source the marketplace entry names:

- **HTTPS registry** (any host other than `localhost` and loopback or link-local addresses): an `archive` source, a
  zip with its `sha256`. Nothing else is needed on your machine.
- **Local registry** (`http://…`, `localhost`, `127.0.0.1`): a `command` source. Claude Code runs
  `skillforge plugin-dir <type>/<name>@<version> --url <base>`, which downloads the plugin into
  `~/.skillforge/plugins` and prints its folder. The `skillforge` CLI must be on the `PATH` Claude Code sees; a shell
  function or alias is not visible to it. Claude Code asks you to accept the command on install and on every update.

## Apply a settings profile

A settings profile is a fragment of Claude Code settings. Its Install tab shows the command with the recommended
scope:

```bash
skillforge settings apply settings/team-baseline --scope project --dry-run
skillforge settings apply settings/team-baseline --scope project
```

| `--scope` | File |
|---|---|
| `user` | `~/.claude/settings.json` |
| `project` | `./.claude/settings.json` |
| `local` | `./.claude/settings.local.json` |

Objects merge recursively, arrays are joined without duplicates (existing order first) and scalars take the profile
value. Each change prints as `<path>: <old> -> <new>`. Before writing, the CLI saves a backup
`<file>.bak-<YYYYMMDDHHmmss>`; `--dry-run` prints the changes without writing. Restart Claude Code afterwards.

## Connect Claude Code over MCP

Create an MCP-enabled token on `/me/tokens` (see [Agent runtimes](README.md#connect-an-agent-over-mcp)). The client
switch selects Claude Code by default and shows two commands:

```bash
claude mcp add --transport http skillforge <server>/mcp --header "Authorization: Bearer <token>"
claude mcp add skillforge -- skillforge mcp
```

The second one runs the `skillforge mcp` stdio bridge, which uses the address and token saved by `skillforge login`.
Claude Code then sees only `active` artifacts, narrowed by the token's MCP tags if it has any.

## Scan the agent folder

```bash
skillforge agent scan .claude --name laptop
skillforge agent scan ~/.claude --name laptop-home --mcp
```

The default folder is `.claude`. With `--mcp`, the CLI also reads these Claude Code MCP configs:

| Scope | File |
|---|---|
| project | `.mcp.json` in the current directory |
| user | `~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json` when `CLAUDE_CONFIG_DIR` is set |

Only names, transport, package and pinned version, the remote origin and variable names are sent, never values. A
config larger than 32 MiB is reported as unreadable instead of being read.

## Other Claude Code features

- **Session metrics.** `skillforge sessions import --harness claude-code` counts registry skill calls in local
  Claude Code session logs (`~/.claude/projects`) and uploads only a few fact fields. `claude-code` is the only
  supported harness. See [Session metrics](../16-session-metrics.md).
- **Skill drafts from sessions.** `skillforge harvest sessions --out <dir> --name <name>` reads what you typed in local
  Claude Code logs and writes a draft skill on disk without contacting the registry.
- **Rollout to repositories.** An admin can open pull requests that add artifacts under `.claude/skills`,
  `.claude/commands` or `.claude/agents` with the `.claude/.skillforge-lock.json` lock file. See the
  [admin handbook](../handbook/admin.md).

## Known limits

- The CLI never unpacks hooks or plugins; they install only through the marketplace.
- Installs through the plugin marketplace do not go through the CLI, so the CLI signature check does not apply to
  them.
- The marketplace without a token lists only artifacts with `org` visibility. Team artifacts install through the
  CLI or an MCP token that can see them.
- An `mcp-server` artifact is not written into Claude Code configs; configure it by hand.

## See also

- [Agent runtimes](README.md) for the comparison of all agents.
- [Artifact types](../05-artifact-types.md) for hooks, plugins and settings profiles.
- [MCP](../13-mcp.md) for MCP tools and consent.
- In-app help: `getting-started/install`, `getting-started/agent-support`, `getting-started/cli`.
