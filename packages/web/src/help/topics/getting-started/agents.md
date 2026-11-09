---
title: Agents
summary: How to snapshot a local agent folder, compare it with the registry and publish local items back to the catalog.
section: access
learn:
  - What a snapshot contains and how statuses are computed
  - How runtime labels and translated installs are handled
  - How to publish an item from a snapshot
  - How administrators register server agents
  - Which CLI commands manage agents
related: getting-started/upload-artifacts, getting-started/cli, getting-started/provenance, pages/me-agents, pages/me-agent, pages/admin-agents, pages/tokens, getting-started/agent-support
---

An **agent** in SkillForge is a named snapshot of a local agent directory — typically the project or user folder of an agent runtime (`.claude`, `.codex`, `.cursor`, `.opencode`, `.qwen`, and so on). The registry stores the snapshot as a list of discovered artifacts (skills, commands, agents, hooks), compares each item to what is already published, and lets contributors publish a local-only or modified item back into the catalog with provenance `agent:<name>`.

## Web cabinet

Signed-in users open **Agents** from the user menu (`menu-agents`) or `/me/agents` to list snapshots, add a folder with `webkitdirectory`, and delete agents. The detail page `/me/agents/:name` shows summary chips, filters, publish and install actions, and a refresh hint. Administrators also get **Agents admin** (`/admin/agents`, `menu-admin-agents`) to register server paths under `SKILLFORGE_AGENT_ROOTS`, rescan, and delete across owners. Help topics under Pages and Actions describe every control.

## What a snapshot contains

When you run `skillforge agent scan <dir> --name <agent>` (or upload a folder in the UI), SkillForge walks the directory (skipping `node_modules` and `.git`), reads `.skillforge-lock.json` if present for installed versions, and sends the files via `PUT /api/v1/me/agents/:name`. Only files that make up artifacts leave your machine (skill folders, commands, agents, hook bundles); everything else, such as `settings.local.json`, `auth.json` or `.env`, stays local, and the CLI prints how many files it kept back. The server runs the same import scanner used elsewhere and parses each candidate. Valid artifacts become snapshot items with a content digest and canonical file hashes; candidates that fail validation appear under `invalid` and are not stored. With `--mcp`, your consent for that run, the CLI also reads the MCP server configs of the runtime and sends only names, transport, package and pinned version, the remote origin and the names of variables (never values); the agent page shows them in `agent-mcp` and admins see them in the inventory.

## Runtime labels and client folders

Every agent carries a runtime label. It can be any runtime of the server runtime table (`GET /api/v1/runtimes`, listed in [Agent support](getting-started/agent-support)), or `generic` for folders that follow no client layout. `skillforge agent scan --runtime <id> --name <agent>` without a folder scans that runtime's project folder by default (`.codex`, `.cursor`, `.opencode`, `.qwen`, …); without `--runtime` the default stays `.claude`. Client folders are recognized like `.claude`, and native client formats are converted to the canonical format before parsing: Codex TOML agents and TOML commands become markdown agents and commands.

## Translated installs

When `skillforge install --runtime <id>` translates an artifact for a client, the lock file records the files actually written. On scan, an item whose files all match that lock entry gets the registry digest and version and the flag `translated: true`, so an untouched translated install compares as `in_sync` (or `outdated`) through the lock instead of `modified`. The agent page shows it with the hint "installed with translation". If any file was changed after install, the usual content comparison applies and the item shows `modified`.

## Statuses versus the registry

Reading an agent recomputes comparison against the live catalog:

| Status | Meaning |
| --- | --- |
| `local_only` | No registry artifact with this type/name |
| `in_sync` | Local digest matches the latest published version |
| `outdated` | Local digest matches an older version (`matched_version`) |
| `modified` | Artifact exists but no version matches; `changed_files` lists path diffs |
| `registry_only` | Active (or all non-retired) catalog entries missing from the snapshot |

> [!NOTE]
> After someone publishes a newer version of a skill you already snapshotted, the same agent becomes `outdated` without uploading again — comparison is always computed on read.

## Publishing from a snapshot

Contributors can publish a single item with `skillforge agent publish <type>/<name> --name <agent>` or the web Publish button. The server reconstructs files from blob storage, runs the normal publish pipeline, and records provenance `{ source: "agent", ref: "<agent>" }` so the artifact card shows the originating agent. Repeat publishes of the same digest return conflict exit code 2. Viewers may own an agent snapshot but cannot publish.

## Server agents and SKILLFORGE_AGENT_ROOTS

Administrators can register **server** agents that live on the SkillForge host inside directories listed in `SKILLFORGE_AGENT_ROOTS` (semicolon- or colon-separated roots; empty disables the feature with `403 agent_roots_disabled`). Paths are checked lexically and again with `fs.realpathSync` so junctions that escape the roots fail with `400 path_outside_roots`. Owners of server agents may call `POST /api/v1/me/agents/:name/scan` (or the Rescan button); upload agents cannot. Admin APIs create, rescan, list (with owner, `roots`, and `roots_enabled`), and delete these agents. Server agents appear in the admin owner's `GET /api/v1/me/agents` list with `kind = "server"`.

## CLI commands

- `skillforge agent scan [dir] --name <agent> [--runtime <id>]` (without `dir`: the project folder of `--runtime`, else `.claude`)
- `skillforge agent status --name <agent>`
- `skillforge agent list`
- `skillforge agent publish <type>/<name> --name <agent> [--version] [--changelog]`
- `skillforge agent rm --name <agent>`

Use `--json` for machine-readable output. Exit codes follow the CLI table (0 success, 1 bad input, 2 conflict, 4 unauthorized, 6 not found). Plugin authors can subscribe to `agent.scanned` whenever a snapshot is saved.