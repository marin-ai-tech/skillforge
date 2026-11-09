# Artifact types

SkillForge stores seven types of artifact. The type you choose when you publish decides which files the package
must contain, which checks run on it, where its files land (the canonical layout) and how it can be installed.
Use this page to pick the right type and to understand the Blocking (`E_*`) and Warning (`W_*`) codes that
validation reports. In-app help: `getting-started/artifact-types`.

## Identity and common rules

An artifact is identified by its type and name together: skill `deploy` and command `deploy` are two different
artifacts. These rules apply to every type:

| Rule | Limit | Code when broken |
|---|---|---|
| Name | 1–64 characters of `a-z0-9-` (lowercase letters, digits, single hyphens) | `E_NAME_INVALID` |
| Description | required, at most 1024 characters | `E_DESCRIPTION_MISSING`, `E_DESCRIPTION_TOO_LONG` |
| Total size of the package | 32 MiB | `E_BUNDLE_TOO_LARGE` |
| Size of one file | 16 MiB | `E_FILE_TOO_LARGE` |
| Number of files | 1000 | `E_TOO_MANY_FILES` |
| Paths | relative, no `..`, no control characters, unique after normalisation | `E_PATH_UNSAFE`, `E_PATH_DUPLICATE` |
| Forbidden folders | nothing under `.git/` or `node_modules/` | `E_PATH_FORBIDDEN` |

`.DS_Store` and `Thumbs.db` files are dropped with the warning `W_FILE_DROPPED`. A name given on the publish
form or with `--name` must match the name found in the package (`E_NAME_MISMATCH`). An unknown type stops
validation at once (`E_TYPE_UNKNOWN`).

Frontmatter that is not valid YAML is read line by line with the warning `W_FRONTMATTER_LOOSE`; a key that is
not known for the type gives `W_UNKNOWN_FRONTMATTER_KEY`, often a typo.

## The seven types at a glance

| Type | Use it for | Required files | Canonical path |
|---|---|---|---|
| `skill` | a reusable procedure | `SKILL.md` (+ optional `scripts/`, `references/`, `assets/`) | `skills/<name>/` |
| `command` | a slash-style prompt | exactly one Markdown file | `commands/<name>.md` |
| `agent` | a subagent persona with its own system prompt | exactly one Markdown file | `agents/<name>.md` |
| `hook` | checks that run before, during or after tool calls | `hooks.json` (+ scripts, `README.md`) | `hooks/hooks.json` |
| `plugin` | a complete Claude Code plugin bundle | `.claude-plugin/plugin.json` + components | plugin root |
| `settings` | an approved Claude Code settings baseline | `SETTINGS.md` + `settings.json` | `settings/<name>/` |
| `mcp-server` | a description of an approved MCP server | `MCP.md` + `server.json` | `mcp/<name>/` |

## skill

A folder centred on `SKILL.md`. The frontmatter must contain `name` and `description`, and the text after the
frontmatter must not be empty (`E_BODY_EMPTY`). The folder name must equal the frontmatter name
(`E_NAME_DIR_MISMATCH`). `compatibility` is at most 500 characters (`E_COMPATIBILITY_TOO_LONG`) and `metadata`
must map strings to strings (`E_METADATA_INVALID`).

```markdown
---
name: release-notes
description: Drafts release notes from merged pull requests. Use when preparing a release; not for changelogs of a single commit.
tags: [git, release]
---

# Release notes

1. Collect the merged pull requests since the last tag.
...
```

Known frontmatter keys include `license`, `compatibility`, `metadata`, `allowed-tools`, `tags`, `category`,
`disable-model-invocation`, `model` and `user-invocable`. A single Markdown file is accepted as a skill and
treated as `SKILL.md`, with the warning `W_SINGLE_FILE_SKILL`. Links to files under `scripts/`, `references/` or
`assets/` that are not in the package give `W_REFERENCE_MISSING`; a `SKILL.md` longer than 500 lines gives
`W_SKILL_MD_LONG`. Exactly one `SKILL.md` must be present (`E_SKILL_MD_MISSING`).

## command

Exactly one Markdown file (`E_SINGLE_FILE_REQUIRED` otherwise). The name comes from the file name; an optional
frontmatter `name` becomes the display name. A description is required, from the frontmatter or the publish
form, and the body must not be empty.

## agent

Exactly one Markdown file with `name` and `description` in its frontmatter. Optional keys include `tools`,
`disallowedTools`, `model`, `effort`, `maxTurns`, `skills`, `memory`, `background` and `isolation`. The only
allowed value of `isolation` is `worktree` (`E_AGENT_ISOLATION_INVALID`). When the file name differs from the
frontmatter name, validation warns with `W_NAME_FILE_MISMATCH`.

## hook

A package with `hooks.json` at its root (`E_HOOKS_JSON_MISSING`). The file holds a `hooks` object that maps an
event to groups of handlers; each handler has a type `command`, `http`, `prompt`, `agent` or `mcp_tool` and the
fields that type needs (`E_HOOK_ENTRY_INVALID`). Invalid JSON or a missing `hooks` object gives
`E_HOOKS_JSON_INVALID`. The description may come from `README.md`.

An event outside the known Claude Code event list warns with `W_HOOK_EVENT_UNKNOWN`. A command that references a
script through `${CLAUDE_PLUGIN_ROOT}` that is not in the package warns with `W_SCRIPT_MISSING`. Hooks are a
Claude Code feature and install only through its plugin marketplace. Every hook gets a risk table in its quality
report; see [Quality and security](09-quality-and-security.md).

## plugin

A self-contained Claude Code plugin: `.claude-plugin/plugin.json` plus components under `skills/<name>/`,
`commands/*.md`, `agents/*.md`, `hooks/hooks.json` (with its scripts) and an optional `.mcp.json`. SkillForge
validates each component with the parser of its own type and stores the whole bundle as one artifact.

| Problem | Code |
|---|---|
| no `.claude-plugin/plugin.json` | `E_PLUGIN_MANIFEST_MISSING` |
| manifest is not an object with a kebab-case `name` and a `description` | `E_PLUGIN_MANIFEST_INVALID` |
| no skills, commands, agents, hooks or MCP servers | `E_PLUGIN_EMPTY` |
| `.mcp.json` is not JSON with an `mcpServers` object | `E_PLUGIN_MCP_INVALID` |

A plugin installs through the Claude Code marketplace (`/plugin install <name>@<marketplace>`); the CLI does not
unpack it into `.claude`. This artifact type is not the same thing as a SkillForge server plugin, which an
administrator installs on the server ([Server plugins](14-plugins.md)).

## settings

An approved Claude Code settings profile. `SETTINGS.md` carries `name`, `description`, `runtime` and `scope`;
`settings.json` holds the fragment that `skillforge settings apply` merges into a Claude Code settings file.

- `runtime` may only be `claude-code` (the default), and `scope` is `user`, `project` (the default) or `local`;
  any other value gives `E_SETTINGS_RUNTIME`.
- A missing `settings.json` gives `E_SETTINGS_JSON_MISSING`, one that is not a JSON object
  `E_SETTINGS_JSON_INVALID`.
- A literal secret in `env` is Blocking (`E_SETTINGS_SECRET`): everyone who can read the registry would see it.
- An unknown top-level key warns with `W_SETTINGS_KEY_UNKNOWN`.

A settings profile is not a marketplace plugin: it has no entry in `marketplace.json` and no plugin archive.

```bash
skillforge settings apply settings/team-baseline --scope project --dry-run
```

## mcp-server

A described MCP server: `MCP.md` (name, description, tags, documentation) and `server.json`, which says how to
run or reach the server with the field names of the official MCP registry. `packages` lists `registryType`
(`npm`, `pypi` or `oci`), `identifier`, `version`, `transport` and `environmentVariables`; `remotes` lists
`type`, `url` and `headers`; `tools` is optional.

| Refused | Code |
|---|---|
| a package without an exact version (an `oci` image needs an `@sha256:` digest) | `E_MCP_UNPINNED` |
| a secret written as a value | `E_MCP_SECRET_LITERAL` |
| an unknown registry type or transport (packages: `stdio`, `streamable-http`, `sse`; remotes: `streamable-http`, `sse`) | `E_MCP_TRANSPORT_UNKNOWN` |
| a start command that runs a shell | `E_MCP_SHELL` |
| a remote address that is not plain `https` | `E_MCP_URL_INVALID` |
| no usable `server.json`, or neither packages nor remotes | `E_MCP_JSON_INVALID` |
| a package type or remote origin outside the company MCP policy | `E_MCP_POLICY` |

SkillForge does not install an MCP server into agents yet: people configure it in their agent by hand, as its
artifact page shows. The MCP policy and the server card are described in [MCP](13-mcp.md).

## Which agents each type reaches

Skills, commands and agents install into every supported agent that has a format for them; the CLI translates
commands and agents where needed. Hooks, plugins and settings profiles are Claude Code features. The full table is
in [Agents](agents/README.md) and in-app help: `getting-started/agent-support`.

## Choosing a type

- A procedure the agent follows when a task matches: `skill`.
- A prompt a person types as a slash command: `command`.
- A persona with its own system prompt and tool list: `agent`.
- A check that must run whether or not the agent asks for it: `hook`.
- Several of the above shipped together for Claude Code: `plugin`.
- A company baseline of Claude Code settings: `settings`.
- An MCP server people may configure: `mcp-server`.

Choosing the wrong type is the most common cause of `E_SKILL_MD_MISSING` and `E_HOOKS_JSON_MISSING`. Check a
package before you publish it:

```bash
skillforge validate .claude/skills/release-notes --type skill
```

## See also

- [Publishing and import](06-publishing-and-import.md) — the ways to get packages into the registry.
- [Quality and security](09-quality-and-security.md) — the advisory score, the security scan and company rules.
- [Versions and channels](10-versions-and-channels.md) — what happens to each published version.
