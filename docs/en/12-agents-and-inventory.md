# Agents and inventory

This page explains agent snapshots: how SkillForge records what is installed in a local agent folder, what
leaves your machine when you send one, how each item compares with the registry, and how to publish a local
item back into the catalog. It also covers the MCP part of a snapshot (`skillforge agent scan --mcp`),
server agents on the SkillForge host, and the organisation inventory that admins use to see what actually
runs on people's machines.

## What an agent snapshot is

An **agent** in SkillForge is a named snapshot of one agent folder — usually the project or user folder of a
runtime, such as `.claude`, `.codex`, `.cursor`, `.opencode` or `.qwen`. The registry stores the snapshot as
a list of the artifacts it found there (skills, commands, agents, hooks) and compares each one with what is
already published.

Every role can keep its own snapshots. Publishing an item from a snapshot needs the `contributor` role or
higher. Snapshots belong to their owner: another user opening the same name gets not-found.

## What leaves your machine

Only the files that make up artifacts are sent: skill folders, commands, agents and hook bundles. Every
other file in the folder stays on your machine — for example `settings.local.json`, `auth.json` or `.env`.
The CLI tells you how many it kept back:

```text
not sent: 3 file(s) outside artifacts
```

The scan skips `node_modules` and `.git`, and reads `.skillforge-lock.json`, if present, to learn which
registry versions were installed. If the folder holds no artifact files at all, nothing is sent and the
command exits with an error.

On the server, each candidate goes through the same parser as a publish. Valid artifacts become snapshot
items with a content digest and file hashes; candidates that fail validation are reported as `invalid` and
are not stored.

## Sending a snapshot

From the CLI:

```bash
skillforge agent scan .claude --name laptop
skillforge agent scan --runtime codex --name laptop-codex     # scans .codex
skillforge agent scan ~/.claude --name home
```

Without a folder, the CLI scans the project folder of `--runtime`, or `.claude` when no runtime is given.
The runtime ids are those of [Agents](agents/README.md); use `generic` for a folder that follows no client
layout. Client formats are converted before parsing: for example, Codex TOML agents and commands are read as
markdown agents and commands.

From the browser: open **Agents** in the user menu (`/me/agents`), choose **Add agent**, enter a kebab-case
name, pick the runtime and select the folder. The browser cannot read every folder (for example a home
folder such as `~/.claude`); use the CLI there.

## Statuses

Comparison is computed every time the snapshot is read, so a snapshot becomes `outdated` as soon as someone
publishes a newer version, without a new scan.

| Status | Meaning |
|---|---|
| `local_only` | No registry artifact has this type and name |
| `in_sync` | The local content matches the latest published version |
| `outdated` | The local content matches an older version (`matched_version`) |
| `modified` | The artifact exists, but no version matches; `changed_files` lists the differences |
| `registry_only` | An active catalog artifact is missing from the snapshot (with **registry-all**, every non-retired status) |

When `skillforge install --runtime <id>` translated an artifact into a client's own format, the lock file
records the files actually written. An untouched translated install is matched through the lock and shows
`in_sync` or `outdated` with the hint "installed with translation". If you edit any of those files, the
usual content comparison applies and the item shows `modified`.

The snapshot page (`/me/agents/<name>`) shows summary chips per status, filters, a copyable
`skillforge install` command for `outdated` and `registry_only` items, and, when the folder contains
colliding copies of the same artifact, a duplicates section with the root to keep.

## Publishing from a snapshot

Publish a `local_only` or `modified` item with the **Publish** button on the snapshot page, or:

```bash
skillforge agent publish skill/local-notes --name laptop
skillforge agent publish skill/local-notes --name laptop --version 1.1.0 --changelog "Add examples"
```

The server rebuilds the files from storage and runs the normal publish pipeline, so every check of
[Quality and security](09-quality-and-security.md) applies. The version records provenance
`agent:<name>`, and the artifact page shows the agent it came from. Publishing the same content again
returns a conflict (exit code 2).

## Other agent commands

```bash
skillforge agent list                    # your snapshots
skillforge agent status --name laptop    # compare a stored snapshot again
skillforge agent rm --name laptop        # delete a snapshot
```

All of them accept `--json`. Deleting a snapshot never removes artifacts you already published.

## MCP servers in a snapshot: `--mcp`

`skillforge agent scan --mcp` also records which MCP servers the agent is configured to use. The flag is your
consent for that one run: without it, the CLI never opens an MCP config.

```bash
skillforge agent scan .claude --name laptop --mcp
skillforge agent scan --runtime cursor --name laptop-cursor --mcp
```

With `--mcp`, the CLI reads the MCP configs of the runtime (Claude Code, Codex, Cursor or OpenCode; other
runtimes are refused with a message that lists the supported ones). Project-level configs are read from the
current directory, so run the command from the project root:

| Runtime | Project config | User config |
|---|---|---|
| Claude Code | `.mcp.json` | `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`) |
| Codex | `.codex/config.toml` | `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) |
| Cursor | `.cursor/mcp.json` | `~/.cursor/mcp.json` |
| OpenCode | `opencode.json`, `opencode.jsonc`, `.opencode/opencode.json(c)` | `~/.config/opencode/opencode.json(c)` |

For each server it sends only:

- the server name, scope and the config file as a template (such as `~/.claude.json`), never a real path;
- the transport;
- the package and its pinned version, or a note that it is not pinned;
- the origin of a remote address (scheme, host and port), never its path or query;
- the names of variables and headers, with a flag when one holds a literal secret;
- whether the server is disabled.

Values never leave the machine: no variable or header values, no arguments, no program paths, no URL paths
and no project paths. Because the registry never receives them, it cannot show them either.

The snapshot page then shows the servers in the **MCP servers** section, with notes such as "not pinned",
"literal secret" (with the variable names) or "disabled". Fix those on your machine: replace a literal secret
with a reference such as `${VAR}`, pin the package to an exact version, then scan again with `--mcp`.

## Server agents

An admin can register agents whose folders live on the SkillForge host itself, inside the directories listed
in `SKILLFORGE_AGENT_ROOTS` (separated by `;` or `:`; empty disables the feature with
`403 agent_roots_disabled`). Paths are checked both as written and after resolving links, so a junction that
leads outside the roots fails with `path_outside_roots`.

Register them on **Agents administration** (`/admin/agents`): enter a kebab-case name, an absolute path under
a root and a runtime. The first scan runs immediately. A server agent belongs to the admin who created it and
appears in their own list with kind `server`; it is refreshed with **Rescan** instead of a new upload.
Admins can also rescan and delete any agent snapshot from that page.

## Organisation inventory

**Inventory** (`/admin/inventory`, admins only) adds up the snapshots of everyone in the organisation. It
answers "what actually stands on our machines".

- **Totals**: people, agents, copies, and copies by state — in sync, outdated, modified, not in the
  registry.
- **Artifacts**: origin (own, imported through import, a mirror or a starter pack, or not in the registry),
  copies, people, variants (different contents) and copies by state. Artifacts that need attention come
  first.
- **People**: agents, copies, copies outside the registry and the time of the last snapshot.

Typical uses:

1. Find artifacts that are not in the registry but have several copies. One variant means people share the
   same file — a good candidate to publish.
2. Look at modified copies of imported artifacts to see where people changed a third-party skill locally.
3. Ask people with old snapshots to send a fresh one.

The inventory shows names and counts only: no folders, file names or file contents. The same data is
available as JSON from `GET /api/v1/admin/inventory`.

### MCP servers in the inventory

When people scan with `--mcp`, the inventory also shows an MCP section (field `mcp` in the JSON):

- totals: agents scanned with `--mcp`, people, distinct servers, installs, unpinned installs, installs with a
  literal secret, remote installs;
- one row per package (for example `package:npx:tickets-mcp`), per remote origin (for example
  `origin:https://mcp.example.com`) or, for local scripts, per name — with names, people, pinned versions and
  counts of unpinned, secret-carrying and disabled installs. Rows with literal secrets come first, then
  unpinned ones;
- a registry column that names the `mcp-server` artifact declaring the same package or origin, with its
  status, or says it is not in the registry: a shadow server.

See [MCP](13-mcp.md) for how to describe approved MCP servers in the registry.

## See also

- [Agents](agents/README.md) — per-runtime folders, install commands and MCP connection.
- [Versions and channels](10-versions-and-channels.md) — digests and versions used in comparisons.
- In-app help: `getting-started/agents`, `pages/me-agents`, `pages/me-agent`, `pages/admin-agents`,
  `pages/admin-inventory`.
