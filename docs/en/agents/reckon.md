# Reckon

Reckon keeps project skills in `.reckon/skills`, including the skills it learns while it works. SkillForge installs
skills there unchanged, and an agent snapshot or an import can bring learned skills back into the registry with
provenance `reckon`. This page lists the folder, what installs, how learned skills are recognized, and the limits.

## On this page

- [Folders](#folders)
- [What installs and how](#what-installs-and-how)
- [Install and sync](#install-and-sync)
- [Connect Reckon over MCP](#connect-reckon-over-mcp)
- [Scan the agent folder and learned skills](#scan-the-agent-folder-and-learned-skills)
- [Import learned skills](#import-learned-skills)
- [Known limits](#known-limits)
- [See also](#see-also)

## Folders

| | Value |
|---|---|
| `--runtime` | `reckon` |
| Project folder | `.reckon` in the current directory |
| User folder | none |
| Lock file | `.reckon/.skillforge-lock.json` |

Support is verified against the real client.

## What installs and how

| Type | How it installs |
|---|---|
| `skill` | copied as is to `.reckon/skills/<name>/` |
| `command` | not supported: "commands are not supported by reckon; publish it as a skill" |
| `agent` | not supported: "agents are not supported by reckon (it has no subagent format SkillForge installs); publish the instructions as a skill" |
| `hook` | not supported: "hooks are not supported by reckon (its hooks use a different event and settings schema); install the hook in Claude Code with /plugin install" |
| `plugin` | not supported: "Claude Code plugins are not supported by reckon; install the plugin in Claude Code with /plugin install" |
| `settings` | not supported: "settings profiles are not supported by reckon (they target Claude Code settings.json)" |
| `mcp-server` | not installed yet; configure it by hand as the artifact page shows |

## Install and sync

```bash
skillforge install skill/pdf-tools --runtime reckon
skillforge sync --runtime reckon --type skill --status active --prune
skillforge outdated --runtime reckon
```

`--scope user` is refused with exit code 1: "the user scope is not supported by reckon (no user-level directory); use
--scope project".

## Connect Reckon over MCP

Reckon has no connect command of its own on the API tokens page. Its MCP connection to SkillForge goes through Claude
Code: connect Claude Code as described in [Claude Code](claude-code.md#connect-claude-code-over-mcp).

## Scan the agent folder and learned skills

A learned skill is a single markdown file `.reckon/skills/<name>.md`. The scanner recognizes it by that path and
turns it into a skill named after its frontmatter `name` (or the file name), with provenance `reckon` and the file
path as the reference. Skills that SkillForge installed are ordinary skill folders `skills/<name>/SKILL.md`.

```bash
skillforge agent scan --runtime reckon --name reckon-project
skillforge agent scan . --runtime reckon --name reckon-project
```

- Without a folder argument the scan reads `.reckon`. That finds the installed skill folders. The learned-skill rule
  matches paths that contain `.reckon/skills/`, so to include learned skills, scan the folder that contains
  `.reckon`, as in the second command. Only files that make up artifacts are sent from it.
- Items that exist only on your machine show `local_only`. Publish one into the catalog with
  `skillforge agent publish skill/<name> --name reckon-project`; its provenance is then `agent:reckon-project`.

`--mcp` is not supported for Reckon: `skillforge agent scan --runtime reckon --mcp` exits with code 1.

## Import learned skills

The Import page (`/import`) also recognizes `.reckon/skills` in a zip archive, a folder or a git repository. Each
learned skill keeps the detected provenance `reckon`, unless you override it before you run the import. Every
imported skill starts as `candidate`, so a reviewer decides before agents get it. Keep the detected provenance:
reviewers use it to decide what to evaluate first. See [Publishing and import](../06-publishing-and-import.md).

## Known limits

- Skills only, in the project scope only.
- No MCP connect command of its own; it goes through Claude Code.
- No MCP config of Reckon is read by `agent scan --mcp`.
- A scan of `.reckon` itself does not pick up learned single-file skills; scan the parent folder or use Import.

## See also

- [Agent runtimes](README.md) for the comparison of all agents.
- [Agents and inventory](../12-agents-and-inventory.md) for snapshot statuses.
- [Lifecycle and review](../07-lifecycle-and-review.md) for promoting imported candidates.
- In-app help: `getting-started/agent-support`, `getting-started/provenance`, `pages/import`.
