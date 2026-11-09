---
title: Agent support
summary: One table of the eight agent runtimes SkillForge serves, what each one supports and how that support is verified.
section: start
learn:
  - Which skills, commands and agents each runtime accepts
  - How each runtime connects to MCP and which folder is scanned
  - Which runtimes are verified against a real client
  - Known limitations of Cursor and Codex
  - How an author lists the agents and versions an artifact is for
related: getting-started/install, getting-started/mcp, getting-started/agents, getting-started/cli
---

SkillForge serves eight agent runtimes. This table is the single place that says what each runtime supports and how that support is verified; the other help topics link here instead of repeating the list. Rows follow the order of the server runtime table (`GET /api/v1/runtimes`), which is also the order of the runtime selectors in the UI.

## Support table

| Runtime | Skills | Commands | Agents | MCP connect (on /me/tokens) | Agent-folder scan | Verified by |
|---|---|---|---|---|---|---|
| Claude Code | `.claude/skills`, `~/.claude/skills` | as is | as is | `claude mcp add` (HTTP or stdio) | `.claude` | real client (marketplace, MCP, settings) |
| Codex | `.codex/skills`, `~/.codex/skills` | not supported (custom prompts are deprecated; publish as a skill) | `.codex/agents/<name>.toml` (see limitation) | `codex mcp add` (token via `SKILLFORGE_TOKEN` or stdio) | `.codex` | real client in automated tests (skills, MCP config); agents: known limitation |
| Gemini CLI | `.gemini/skills`, `~/.gemini/skills` | `commands/<name>.toml` | not supported | any MCP client: HTTP `<server>/mcp` with `Authorization: Bearer` | `.gemini` | documentation |
| Cursor | `.cursor/skills`, `~/.cursor/skills` | body only, project scope | `name` + `description` frontmatter | JSON for `~/.cursor/mcp.json` | `.cursor` | documentation (client not installed on the test stand) |
| OpenCode | `.opencode/skills`, `~/.config/opencode/skills` | `description` frontmatter | `description` + `mode: subagent` | `opencode mcp add` | `.opencode` | real client in automated tests |
| Qwen Code | `.qwen/skills`, `~/.qwen/skills` | `$ARGUMENTS` → `{{args}}` | as is | `qwen mcp add -s user` | `.qwen` | real client in automated tests |
| Devin | `.agents/skills` (project only) | not supported | not supported | any MCP client (as Gemini CLI) | `.agents` | documentation |
| Reckon | `.reckon/skills` (project only) | not supported | not supported | through Claude Code | `.reckon` (learned skills) | real client |

## How to read the table

- **Skills** shows the project folder and, where the runtime has one, the user folder that `skillforge install --runtime <id>` writes to (`--scope project` or `--scope user`). Skill files are copied unchanged.
- **Commands** and **Agents** show how the CLI translates the canonical markdown for that runtime. "As is" means the file is copied unchanged; "not supported" means the Install tab and the CLI show the reason instead of a command.
- **MCP connect** is the client choice on `/me/tokens` after you create an MCP-enabled token.
- **Agent-folder scan** is the folder that `skillforge agent scan --runtime <id>` and the Add agent dialog read for that runtime.
- **Verified by** says whether support was checked against the real client or only against the client documentation.

## Hooks, plugins and settings profiles

Hooks, plugins and settings profiles are Claude Code features. Hooks and plugins install through the Claude Code marketplace (`/plugin install <plugin>@<marketplace>`), and settings profiles are applied with `skillforge settings apply`. For the other runtimes the Install tab explains why the type cannot be installed. An `mcp-server` is not installed into any runtime yet: its page shows what the server runs and which variables each person sets.

## Which agents an artifact is for

Every artifact answers this in two layers. The registry computes the agents its type installs into from the table above: a skill installs into every runtime, while a command does not install into Codex, Devin or Reckon. On top of that the author may list the agents the artifact is meant for, each with an optional minimum version, for example `claude-code>=2.1,codex`. Without such a list the artifact counts as fit for every agent its type installs into.

- **Format.** Each entry is `agent` or `agent>=version`, separated by commas; the agent ids are the `--runtime` ids and the version is `N`, `N.N` or `N.N.N`. The registry rejects an unknown agent, a malformed version, an agent listed twice, and an agent the type does not install into, quoting the reason from the table (error `agents_invalid`).
- **Where to set it.** Pass `--agents` to `skillforge publish` (see [Using the CLI](getting-started/cli)), or change the Agents field in the metadata panel later without a new version (see [Editing metadata without a version](getting-started/metadata)).
- **Where it shows.** A catalog card shows the listed agents with their minimum versions, such as Claude Code ≥ 2.1, or "Agents: N" when the author listed none. The Overview tab has an Agents section with every runtime: whether the type installs there (with the reason if not) and whether the author listed it, from which version (see [Artifact page](pages/artifact)).
- **Catalog filter.** The Agent filter keeps artifacts whose type installs into that agent and whose list is empty or names it; the URL keeps `agent=<id>` (see [Catalog](pages/catalog)).
- **Install warning.** The list is advice, not a ban. `skillforge install skill/name --runtime cursor` installs as usual and keeps its exit code, but prints `warning: <type>/<name> is declared for …; <runtime> is not in the list` to stderr when the agent is not listed, or `note: declared for <runtime> >= <version>` when it is listed with a minimum version. The CLI does not check which version of the agent you have; with `--json` nothing is printed.

## Known limitations

- Cursor is checked by documentation only: the client is not installed on the test stand.
- Codex 0.158 did not list SkillForge-installed agents in a manual check. Re-check on a newer Codex.

## See also

- [Installing into your agent](getting-started/install) for the `--runtime` ids, directories and scopes, and the Claude Code plugin marketplace.
- [MCP access for agents](getting-started/mcp) for the connect commands of each client.
- [Agents](getting-started/agents) for snapshots of local agent folders.
