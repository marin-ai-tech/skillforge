---
title: Artifact types
summary: The eight package types SkillForge stores and the rules each one follows. Picking the right type on Publish avoids the most common Blocking errors.
section: start
learn:
  - Which files and frontmatter each type requires
  - Which type to choose for a procedure, prompt, persona, hook, plugin, settings baseline or MCP server
  - How the advisory quality score and grade are calculated
related: getting-started/overview, getting-started/lifecycle
---

SkillForge stores eight package types. Choosing the correct type on Publish selects the parser rules, canonical paths, and Overview primary file.

> [!WARNING]
> Wrong type selection is a common source of Blocking errors such as `E_SKILL_MD_MISSING` or `E_HOOKS_JSON_MISSING`.

## skill

A folder centered on `SKILL.md` with optional `scripts/`, `references/`, and `assets/`. Canonical paths live under `skills/<name>/`. Frontmatter must include `name` and `description`; body after frontmatter must be non-empty. Compatibility is at most 500 characters; metadata is string-to-string. Single-file uploads are accepted with Warning `W_SINGLE_FILE_SKILL` and rewritten to `SKILL.md`. Relative links to missing references warn with `W_REFERENCE_MISSING`.

## command

Exactly one markdown file. Name comes from the filename stem; optional frontmatter `name` becomes displayName. Canonical path `commands/<name>.md`. Body required. Extra files yield Blocking `E_SINGLE_FILE_REQUIRED`.

## agent

Exactly one markdown file with required frontmatter `name` and `description`. Optional tools, model, isolation (`worktree` only), and related agent keys. Canonical path `agents/<name>.md`. File basename mismatches warn with `W_NAME_FILE_MISMATCH`. Invalid isolation yields `E_AGENT_ISOLATION_INVALID`.

## hook

Must include `hooks.json` defining a `hooks` object of event to groups to HookEntry list (command, http, prompt, agent, mcp_tool). Hooks are a Claude Code feature and install only through its plugin marketplace. Canonical layout includes `hooks/hooks.json` plus scripts and README. Description may come from README. Unknown events warn; missing scripts referenced via `${CLAUDE_PLUGIN_ROOT}` warn with `W_SCRIPT_MISSING`.

## plugin

A self-contained Claude Code plugin bundle with `.claude-plugin/plugin.json` plus components: `skills/<name>/`, `commands/*.md`, `agents/*.md`, `hooks/hooks.json` (and scripts), and optional `.mcp.json`. SkillForge validates each component with its existing parser and stores the whole bundle as one artifact. Install via Claude Code marketplace (`/plugin install <name>@<marketplace>`); the CLI does not unpack plugin files into `.claude`.

> [!NOTE]
> Do not confuse this artifact type with SkillForge server plugins under Admin → Plugins.

## settings

An approved Claude Code settings profile: `SETTINGS.md` (name, description, `runtime`, `scope`) plus `settings.json` (fragment merged by `skillforge settings apply`). Canonical paths live under `settings/<name>/`. Literal secrets in `env` are Blocking (`E_SETTINGS_SECRET`); unknown top-level keys warn with `W_SETTINGS_KEY_UNKNOWN`. Profiles are not marketplace plugins (no `marketplace.json` entry, plugin archive is 404). Quality may flag bypass mode, broad allows, `apiKeyHelper`, and embedded hooks (`Q_SETTINGS_*`).

## mcp-server

A described MCP server: `MCP.md` (name, description, tags, documentation) plus `server.json` (how to run or reach it, with the field names of the official MCP registry: `packages` with `registryType` `npm`, `pypi` or `oci`, `identifier`, `version`, `transport`, `environmentVariables`; `remotes` with `type`, `url`, `headers`; optional `tools`). Canonical paths live under `mcp/<name>/`. Publishing refuses an unpinned package (`E_MCP_UNPINNED`), a literal secret (`E_MCP_SECRET_LITERAL`), an unknown type or transport (`E_MCP_TRANSPORT_UNKNOWN`), a shell (`E_MCP_SHELL`), a remote address that is not plain `https` (`E_MCP_URL_INVALID`) and a missing or empty `server.json` (`E_MCP_JSON_INVALID`). An admin sets the MCP policy on the lifecycle page (`mcp-policy`): which package types may be published and which remote origins (`https://host` or `https://*.domain`) are allowed; without any origin, remote servers are not published, and a version outside the policy is refused with `E_MCP_POLICY`. On the Overview, the section `mcp-card` shows what the server runs, its variables marked secret or required, remote addresses, tools, whether the version matches the current policy and how many people already use it according to the inventory (counts only). An MCP server is not a marketplace plugin, and SkillForge does not install it into agents yet: configure it in the agent by hand.

## rule

A project rule: one markdown file `rules/<name>.md` with frontmatter `name`, `description`, optional `paths` (a list of file patterns, for example `["src/api/**/*.ts"]`) and `tags`. A rule without `paths` applies always and is loaded on every turn of the agent, so its length is limited (`E_RULE_ALWAYS_LONG`); a rule with `paths` is loaded when the agent works with those files. Publishing refuses `paths` that are not a list of patterns (`E_RULE_PATHS_INVALID`) and more than one file (`E_RULE_EXTRA_FILE`). `skillforge install rule/<name>` writes `.claude/rules/<name>.md` for Claude Code (project or user scope) and `.cursor/rules/<name>.mdc` for Cursor (project scope); For OpenCode (project scope) it writes `.opencode/rules/<name>.md` and adds `.opencode/rules/*.md` once to `instructions` in the project's OpenCode config (a new `opencode.json` when there is none; comments and other keys stay; a config it cannot read stops the install with the line to add by hand); OpenCode has no path rules, so a rule with `paths` loads on every turn there. Codex, Gemini CLI and Qwen Code read their rules from `AGENTS.md`, `GEMINI.md` and `QWEN.md`, where SkillForge does not write yet. A rule has no uses to count, so it ages by confirmation: a fresh `validate` by a reviewer or a `gate` evidence by the owner brings an aging rule back to active.

## Choosing

Use skill for reusable procedures, command for slash-style prompts, agent for system-prompt personas, hook for pre/mid/post verification, plugin for a full Claude Code plugin bundle, settings for company baselines applied with the CLI, and mcp-server for an approved MCP server people configure in their agents. Skills, commands and agents install into every supported agent ([Agent support](getting-started/agent-support) shows which types each one accepts); hooks, plugins and settings profiles are Claude Code features. Types are filtered on Home counts and Catalog tabs. In Claude Code, marketplace distribution maps every type except settings and mcp-server to plugin folders. Bundle limits still apply to every type: 32 MiB total, 16 MiB per file, at most 1000 files.

## Quality score

Besides Blocking errors and Warnings, every successfully parsed version gets an advisory prompt-quality report: `score` from 0 to 100 and `grade` A (90+), B (75+), C (60+) or D. Each `Q_*` code that fires costs 15 points (warn) or 5 points (info), charged once per code regardless of how many places it was found. The report never blocks publication and is stored with the version, so a new version can improve the grade without touching the old one. Skills are checked against all ten codes; commands skip `Q_REF_DEEP`; agents skip `Q_REF_DEEP` and `Q_NO_EXAMPLE`; hooks are only checked for `Q_TIME_SENSITIVE` and `Q_WINDOWS_PATH`. Open a code topic (for example `Q_DESC_NO_TRIGGER`) for causes and fixes.
