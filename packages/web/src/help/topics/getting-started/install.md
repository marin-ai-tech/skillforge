---
title: Installing into your agent
summary: How to install approved skills, commands and agents into any of the eight supported agents, connect an agent over MCP, and use the Claude Code plugin marketplace for hooks and plugins.
section: start
learn:
  - How to install a skill, command or agent into your agent with the CLI or the Install tab
  - Which directory each agent reads and which artifact types it accepts
  - How an agent reads skills over MCP instead of installed files
  - How the Claude Code plugin marketplace installs hooks and plugins, and how settings profiles are applied
related: pages/artifact, pages/home, getting-started/lifecycle, getting-started/overview, getting-started/cli, getting-started/agent-support
---

SkillForge installs approved (`active`) artifacts into eight agents: Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Qwen Code, Devin and Reckon. There are three ways to bring an artifact to your agent:

- **The SkillForge CLI** writes skills, commands and agents into the directory your agent reads. It works for every agent.
- **MCP** lets your agent search and read approved skills in the registry without installing files.
- **The Claude Code plugin marketplace** installs artifacts as plugins. It exists only in Claude Code, and it is the only way to install hooks and plugins, which are Claude Code features.

Settings profiles target Claude Code settings, so they also apply only to Claude Code. [Agent support](getting-started/agent-support) has the full support table, including how each agent is verified.

## Install with the CLI

Install one artifact into your agent, or install and update every artifact that matches a filter:

```text
skillforge install <type>/<name> --runtime <id> [--scope project|user]
skillforge sync --runtime <id> [--type <type>] [--tag <tag>] [--prune]
```

`--runtime` picks the agent; without it the CLI installs into `.claude`. `--scope project` (default) resolves against the current directory, `--scope user` against your home directory. The CLI keeps a `.skillforge-lock.json` in the agent directory, and `sync`, `outdated` and `uninstall` take the same `--runtime` and `--scope`. Each agent keeps its own lock under its base directory:

| Agent | `--runtime` | Project directory | User directory | Skills | Commands | Agents |
|---|---|---|---|---|---|---|
| Claude Code | `claude-code` | `.claude` | `~/.claude` | yes | yes | yes |
| Codex | `codex` | `.codex` | `~/.codex` | yes | no | yes (TOML) |
| Gemini CLI | `gemini` | `.gemini` | `~/.gemini` | yes | yes (TOML) | no |
| Cursor | `cursor` | `.cursor` | `~/.cursor` | yes | project scope only | yes |
| OpenCode | `opencode` | `.opencode` | `~/.config/opencode` | yes | yes | yes |
| Qwen Code | `qwen` | `.qwen` | `~/.qwen` | yes | yes | yes |
| Devin | `devin` | `.agents` | — | yes | no | no |
| Reckon | `reckon` | `.reckon` | — | yes | no | no |

Skills are copied unchanged into every agent. Commands and agents are translated to the agent's format; when the agent has no equivalent, the CLI exits with code 1 and a `not supported by <runtime>` reason (for example, publish a command as a skill for an agent without slash commands). Devin and Reckon have no user-level directory. Hooks and plugins are never unpacked: `install` exits with code 1 and prints the `/plugin install <plugin>@<marketplace>` command for Claude Code, and `sync` lists them as skipped. Settings profiles are applied with `skillforge settings apply` (see below). An `mcp-server` describes an approved MCP server; SkillForge does not write it into agent configs yet, so configure it by hand as its artifact page shows.

For Codex the user scope is always `~/.codex`: SkillForge does not read `CODEX_HOME`. If you set `CODEX_HOME`, install skills with `--into "$CODEX_HOME"` instead (`--into` copies files without translation, so use it for skills only).

> [!NOTE]
> **Older Codex installs under `.agents`:** older `install --runtime codex` wrote skills under `.agents`. Those files still work (Codex still reads project `.agents/skills`), but their lock stays in `.agents`, so `sync --runtime codex` no longer sees them. Manage them with `skillforge sync --into .agents`, or move with `skillforge uninstall … --into .agents` then `skillforge install … --runtime codex`. User-level installs that were under `~/.agents/skills` were never visible to Codex; installing again with `--runtime codex --scope user` places them in `~/.codex/skills`.

Before writing or deleting anything, the CLI resolves the agent directory and the nearest existing parent of every target with realpath and stops with exit code 1 if a symlink or junction would lead outside it, so a partial install never happens. For login, publishing and exit codes, see [Using the CLI](getting-started/cli).

## Install from the artifact page

On the Install tab of an `active` artifact, pick your agent in `install-runtime-select`. The tab shows `install-runtime-cmd` with the command to copy, or `install-runtime-unsupported` with the reason when that agent cannot install this artifact type. The list and its order come from the server runtime table, so they always match [Agent support](getting-started/agent-support).

## Read skills over MCP

An agent that speaks the Model Context Protocol can search and read approved skills in the registry instead of installed files. Create an MCP-enabled token on `/me/tokens`, pick your client and copy its connect command. MCP is read-only and shows only `active` artifacts. The connect commands of every client are in [MCP access for agents](getting-started/mcp).

## Claude Code plugin marketplace

Only Claude Code has a plugin marketplace, and SkillForge can act as one. Approved (`active`) artifacts are published as deterministic plugin archives with a `.claude-plugin/plugin.json` manifest and the canonical layout Claude Code expects. In Claude Code any active artifact can be installed this way; hooks and plugins can be installed only this way.

In Claude Code, add this registry once:

```text
/plugin marketplace add <SKILLFORGE_BASE_URL>/marketplace.json
```

The same command appears on the Home page (`home-install`) and on each artifact Install tab. The marketplace name defaults to `skillforge` (`SKILLFORGE_MARKETPLACE_NAME`); the owner label defaults to `SkillForge`. Only artifacts in status `active` appear in the default listing. Pass `?status=candidate,active` when you intentionally want candidates too.

Then install an approved plugin:

```text
/plugin install <plugin>@<marketplace>
```

Plugin naming: skills keep their artifact name (`pdf-tools-e2e`); commands, agents, and hooks append the type (`destructive-guard-hook`, `propose-command`, `handoff-executor-agent`). The Install tab shows the exact command for the current artifact when its status is `active`.

## How Claude Code fetches a plugin

Each marketplace entry tells Claude Code (2.1.288 or newer) where the plugin comes from. The server picks the form from `SKILLFORGE_BASE_URL` (override with `SKILLFORGE_MARKETPLACE_SOURCE=auto|archive|command`):

- **HTTPS server** (any host except `localhost` and loopback/link-local addresses): an `archive` source — a zip with its `sha256`. Nothing else is needed on the client.
- **Local stand** (`http://…`, `localhost`, `127.0.0.1`): a `command` source — Claude Code runs `skillforge plugin-dir <type>/<name>@<version> --url <base>`, which downloads the plugin into `~/.skillforge/plugins` and prints its folder. The `skillforge` CLI must be on `PATH` for Claude Code (on Windows run `npm run cli:link`; a PowerShell function is not visible to it), and Claude Code asks you to accept the command in an interactive terminal on install and again on every update.

## Direct downloads

Every version also exposes:

- Plugin zip: `/api/v1/plugins/<type>/<name>/<version>.zip` (use `latest`) — the plugin root at the archive root; this is what the `archive` source downloads
- Plugin tarball: `/api/v1/plugins/<type>/<name>/<version>.tar.gz` (use `latest`) — for type `plugin` the files sit under a `<plugin>/` folder
- Source bundle zip: `/api/v1/artifacts/<type>/<name>/versions/<version>/bundle.zip`

Plugin archives include `.claude-plugin/plugin.json` plus canonical files with deterministic bytes (repeated downloads are identical; tarball scripts are executable). The source bundle omits `plugin.json` and is meant for inspection or offline packaging. Download counters increment only on HTTP 200 responses, not on 304 cache hits.

## Active-only rule

Install commands, in the marketplace and for every agent on the Install tab, are shown only for `active` artifacts. Candidates and other lifecycle states still allow direct archive downloads, but Claude Code will not see them in the default marketplace feed until a reviewer promotes them.

> [!WARNING]
> Prefer promoting through the lifecycle panel rather than installing candidates into production agents.

## Settings profiles (Claude Code only)

A settings profile is a fragment of Claude Code settings, so it applies only to Claude Code. The Install tab of a settings profile shows the command with the recommended scope:

```text
skillforge settings apply settings/<name> [--scope user|project|local] [--dry-run]
```

The CLI merges the fragment into the Claude Code settings file of that scope and writes a backup first; `--dry-run` prints the changes without writing.

## Troubleshooting

- `not supported by <runtime>`: your agent has no format for this artifact type; [Agent support](getting-started/agent-support) shows what it accepts.
- Empty plugins array: nothing is `active` yet, or you filtered with `type=` that has no matches.
- 404 on tarball: wrong type/name/version, or the version was never published.
- ETag / 304: marketplace responses are cacheable; republishing or transitioning bumps the cache so clients refetch.
- Config errors naming `SKILLFORGE_MARKETPLACE_NAME` usually mean the value was not kebab-case (`a-z0-9` with single hyphens, 1–64 chars).

## Signed releases

The registry signs the exact files of every version it publishes, and `skillforge install` and `skillforge sync` check them before writing anything: every file in the bundle must match the signed list, and the signature must match the registry's public key from `/api/v1/install-info`. A changed, missing or extra file stops the install with `does not match`. A version signed before this check existed is signed when the server starts; a version with no signature installs with a `not signed` warning.

`skillforge login` remembers the registry's key. If the key later changes, for example after restoring the server without its data folder, the install stops with `signing key changed` until you sign in again. A signature proves the files are the ones this registry holds; whether a version was approved is its lifecycle status. Installs through the Claude Code plugin marketplace do not go through the CLI and are not checked.
