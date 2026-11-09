# Agent runtimes

SkillForge installs approved artifacts into eight agent runtimes: Claude Code, Codex, Gemini CLI, Cursor, OpenCode,
Qwen Code, Devin and Reckon. This page compares them in one place and explains what is the same for every agent. Each
agent also has its own page with its folders, the types it accepts, its MCP connection and its known limits.

## On this page

- [Support at a glance](#support-at-a-glance)
- [Three ways to bring an artifact to an agent](#three-ways-to-bring-an-artifact-to-an-agent)
- [Install and sync with the CLI](#install-and-sync-with-the-cli)
- [Connect an agent over MCP](#connect-an-agent-over-mcp)
- [Scan an agent folder](#scan-an-agent-folder)
- [Which agents an artifact is for](#which-agents-an-artifact-is-for)
- [Agent pages](#agent-pages)
- [See also](#see-also)

## Support at a glance

The order of the rows is the order of the server runtime table (`GET /api/v1/runtimes`), which is also the order of
the runtime selectors in the web interface.

| Agent | `--runtime` | Project folder | User folder | Skills | Commands | Agents | MCP connect | `agent scan --mcp` |
|---|---|---|---|---|---|---|---|---|
| [Claude Code](claude-code.md) | `claude-code` | `.claude` | `~/.claude` | as is | as is | as is | `claude mcp add` | yes |
| [Codex](codex.md) | `codex` | `.codex` | `~/.codex` | as is | not supported | TOML | `codex mcp add` | yes |
| [Gemini CLI](gemini-cli.md) | `gemini` | `.gemini` | `~/.gemini` | as is | TOML | not supported | any MCP client over HTTP | no |
| [Cursor](cursor.md) | `cursor` | `.cursor` | `~/.cursor` | as is | body only, project scope | `name` + `description` | JSON for `~/.cursor/mcp.json` | yes |
| [OpenCode](opencode.md) | `opencode` | `.opencode` | `~/.config/opencode` | as is | `description` frontmatter | `description` + `mode: subagent` | `opencode mcp add` | yes |
| [Qwen Code](qwen-code.md) | `qwen` | `.qwen` | `~/.qwen` | as is | `$ARGUMENTS` becomes `{{args}}` | as is | `qwen mcp add -s user` | no |
| [Devin](devin.md) | `devin` | `.agents` | none | as is | not supported | not supported | any MCP client over HTTP | no |
| [Reckon](reckon.md) | `reckon` | `.reckon` | none | as is | not supported | not supported | through Claude Code | no |

- **Skills** are copied unchanged into every agent.
- **Commands** and **agents** are written in Claude Code markdown in the registry. The CLI translates them into the
  agent's format; "as is" means the file is copied unchanged. When an agent has no format for the type, the Install tab
  and the CLI show the reason instead of a command.
- **Hooks, plugins and settings profiles** are Claude Code features. They install only into Claude Code: hooks and
  plugins through its plugin marketplace, settings profiles with `skillforge settings apply`.
- **MCP servers** (type `mcp-server`) are not installed into any agent yet. The artifact page shows what the server
  runs and which variables each person sets, and you configure it in the agent by hand.

Claude Code, OpenCode, Qwen Code and Reckon are verified against the real client, and Codex for skills and its MCP
config. Gemini CLI, Cursor and Devin are checked against the client documentation only.

## Three ways to bring an artifact to an agent

| Way | Works for | What it does |
|---|---|---|
| SkillForge CLI | every agent | writes skills, commands and agents into the folder the agent reads, with a lock file |
| MCP | any agent that speaks MCP | lets the agent search and read active artifacts in the registry without installed files |
| Claude Code plugin marketplace | Claude Code only | installs any active artifact as a plugin; the only way to install hooks and plugins |

Install commands appear only for `active` artifacts, on the Install tab of the artifact page and in the marketplace.

## Install and sync with the CLI

Install one artifact, or install and update every artifact that matches a filter:

```bash
skillforge install skill/pdf-tools --runtime codex
skillforge install skill/pdf-tools --runtime codex --scope user
skillforge sync --runtime opencode --type skill --tag frontend --prune
skillforge outdated --runtime opencode
skillforge uninstall skill/pdf-tools --runtime codex
```

- `--runtime` picks the agent. Without it the CLI installs into `.claude`.
- `--scope project` (the default) resolves the folder against the current directory; `--scope user` resolves it
  against your home directory. Devin and Reckon have no user folder.
- Each agent keeps its own `.skillforge-lock.json` in its folder. `sync`, `outdated` and `uninstall` take the same
  `--runtime` and `--scope` as `install`.
- `--into <dir>` copies files into any folder without translation. It cannot be combined with `--runtime` or
  `--scope`, so use it for skills only.
- An unsupported combination exits with code 1 and a `not supported by <runtime>` reason. Hooks and plugins exit
  with code 1 from `install` and print the `/plugin install <plugin>@<marketplace>` command; `sync` lists them as
  skipped and exits 0.
- When the CLI translates a file and has to drop something, it prints `warning: …` to stderr, for example
  `agent reviewer: dropped tools, model (not supported by cursor)`.

Before writing anything, the CLI checks the signature of the version against the registry key remembered at login,
and stops if a symlink or junction would lead outside the agent folder. Method packs install the same way:
`skillforge pack install team-method@1.0.0 --role developer --runtime codex`.

On the Install tab of an active artifact, pick your agent in the runtime selector. The tab shows the command to copy,
such as `skillforge install skill/pdf-tools --runtime cursor`, or the reason the agent cannot install this type.

## Connect an agent over MCP

SkillForge is itself an MCP server. An agent connected to it can call four tools: `search_artifacts`, `get_artifact`,
`read_artifact_file` and `record_usage`. It sees only `active` artifacts and cannot publish, change status or install
files.

1. Sign in to the web interface and open **API tokens** (`/me/tokens`).
2. Create a token and select **Allow agents to load active skills via MCP**. Optionally add up to ten MCP tags to
   limit the agent to artifacts that share a tag.
3. Copy the secret. Under it, pick your client in the switch (Claude Code, Codex, Cursor, OpenCode or Qwen Code) and
   copy the HTTP command or the stdio command.

The stdio commands run the `skillforge mcp` bridge, which takes the server address and token saved by
`skillforge login`. An MCP token works only for agents: the REST API refuses it with `403 mcp_token_forbidden`, so
use a separate regular token for `install`, `sync` and `publish`. Any other MCP client connects over HTTP to
`<server>/mcp` with the header `Authorization: Bearer <token>`. See [MCP](../13-mcp.md).

## Scan an agent folder

An agent snapshot sends the artifacts of a local folder to the registry and compares each one with what is
published. Without a folder argument, `--runtime` picks the agent's project folder; without `--runtime` the folder is
`.claude`:

```bash
skillforge agent scan --runtime cursor --name laptop-cursor
skillforge agent scan --runtime codex --name laptop-codex --mcp
```

Only files that make up artifacts leave your machine. Codex TOML agents and TOML commands are converted to markdown
before they are parsed, and an untouched install that the CLI translated compares as `in_sync` or `outdated` through
the lock file instead of `modified`.

`--mcp` is your consent, for this run only, to also read the agent's MCP server configs and send their names,
transport, package and pinned version, remote origin and variable names, never values. It works for Claude Code,
Codex, Cursor and OpenCode; any other runtime exits with code 1. See [Agents and inventory](../12-agents-and-inventory.md).

## Which agents an artifact is for

The registry computes the agents a type installs into from the table above: a skill installs into every agent, a
command does not install into Codex, Devin or Reckon. An author can also list the agents an artifact is meant for,
each with an optional minimum version:

```bash
skillforge publish ./skills/pdf-tools --type skill --version 1.2.0 --agents "claude-code>=2.1,codex"
```

The agent ids are the `--runtime` ids, and versions look like `2`, `2.1` or `2.1.3`. The registry rejects an unknown
agent, a malformed version, a repeated agent and an agent the type does not install into (`agents_invalid`). The
catalog has an **Agent** filter, and the artifact Overview has an Agents section with one row per runtime.

The list is advice, not a ban. Installing into an agent that is not listed works and keeps its exit code, but prints
`warning: <type>/<name> is declared for …; <runtime> is not in the list` to stderr. The CLI does not check which
version of the agent you have.

## Agent pages

- [Claude Code](claude-code.md): every type, the plugin marketplace and settings profiles.
- [Codex](codex.md): skills and TOML agents; no commands.
- [Gemini CLI](gemini-cli.md): skills and TOML commands; no agents.
- [Cursor](cursor.md): skills, project commands and agents.
- [OpenCode](opencode.md): skills, commands and subagents.
- [Qwen Code](qwen-code.md): skills, commands and agents.
- [Devin](devin.md): project skills only.
- [Reckon](reckon.md): project skills only, and learned skills on scan.

## See also

- [Artifact types](../05-artifact-types.md) for the seven types and their files.
- [Versions and channels](../10-versions-and-channels.md) for version specs, pins and downgrades.
- [MCP](../13-mcp.md) for the MCP tools, token consent and MCP server artifacts.
- In-app help: `getting-started/agent-support`, `getting-started/install`, `getting-started/mcp`.
