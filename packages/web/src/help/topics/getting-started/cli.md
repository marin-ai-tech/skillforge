---
title: Using the CLI
summary: The skillforge command-line client for CI and local shells: sign in, publish, install with a lock file and gate pipelines on exit codes.
section: start
learn:
  - How to log in and where credentials are stored
  - How to validate and publish from CI
  - How install, sync and the lock file keep folders in step
  - What each exit code means
related: getting-started/upload-artifacts, getting-started/install, pages/tokens, actions/tokens/create, getting-started/agent-support
---

The SkillForge CLI (`skillforge`) is a thin client for the registry HTTP API. Use it from CI, local shells, and automation to authenticate, validate and publish artifacts, browse the catalog, and install approved packages into an agent runtime's folder with a lock file.

## Install and run

Install the CLI from your registry: `npm i -g <registry>/downloads/skillforge-cli.tgz` — the home page shows the exact command with the registry address. The package is one file without dependencies and needs Node.js 24 or newer. From source, after building the monorepo, run the binary from `packages/cli` or via `npx skillforge` once the workspace package is linked. The CLI prints a semver on `skillforge --version` and lists commands on `skillforge --help` (login, publish, install, sync, validate, info, and more). Prefer `NO_COLOR=1` or `--no-color` in CI logs.

## Login and config

Authenticate with a Bearer token or an interactive password flow:

- `skillforge login --url <base> --token <sf_...>` verifies the token with `GET /api/v1/me` and stores it.
- `skillforge login --url <base> --username <user> --password-stdin` reads the password from stdin (first line), creates a session cookie, then creates an API token named `cli <hostname>`. The password is never written to disk.

Credentials live in `~/.skillforge/config.json` (mode `0600` on POSIX) or the path in `SKILLFORGE_CONFIG`. Override the registry with `--url` / `SKILLFORGE_URL` and the token with `--token` / `SKILLFORGE_TOKEN` (flags win over env over config). A stored token is sent only when the selected registry URL matches that entry (trailing slash stripped, host compared case-insensitively); a mismatched `--url` or `SKILLFORGE_URL` does not reuse another registry's token. Use `skillforge whoami` and `skillforge logout` to inspect or revoke the stored token.

## Validate and publish in CI

Point CI at a directory or a single markdown file:

```bash
skillforge validate path/to/skill --type skill --json
skillforge publish path/to/skill --type skill --version 1.2.0 --changelog "..." --provenance reckon:run-7
```

The CLI prints Blocking `E_*` and Warning `W_*` codes, then `type/name@version` and the card URL on success. Conflicts such as `digest_exists` exit with code 2; validation failures exit with code 1; missing auth exits with code 4.

`--agents <list>` lists the agents the artifact is for, each with an optional minimum version: `skillforge publish path/to/skill --type skill --version 1.2.0 --agents claude-code>=2.1,codex`. The CLI checks the list before sending anything and exits with code 1 on an unknown agent, a malformed version or a repeated agent; the registry also rejects an agent the type does not install into with `agents_invalid` (code 1). The list is stored with the version; a later publish without `--agents` keeps the previous version's list, and an empty `--agents ""` clears it. See [Agent support](getting-started/agent-support) for the format.

## Install, sync, and the lock file

`skillforge install skill/name[@version] --into .claude` downloads `bundle.zip`, writes canonical paths under the install root, and records `version`, `digest`, per-file sha256, and `installed_at` in `.skillforge-lock.json`. Re-running the same version prints `up to date`. If a tracked file was edited locally, install exits with code 5 unless you pass `--force`. Lock file paths are validated before any delete or overwrite; a corrupt lock with unsafe paths (`..`, backslashes, or absolute paths) stops the command with exit code 1 and leaves files and the lock unchanged. Install refuses to overwrite unmanaged files that are not listed in the current lock entry unless you pass `--force`.

> [!WARNING]
> `--force` overwrites locally edited tracked files and unmanaged files alike; check what changed before you use it.

Before writing files, `install` and `sync` check three things. A version whose security scan failed is refused with exit code 1 until you review it and pass `--allow-risky`. Moving to a lower version than the installed one is refused with exit code 5 unless you pass `--allow-downgrade`. Every file and the version signature are checked against the registry key remembered at login; a different key stops the command with `signing key changed` until you run `skillforge login` again, and a damaged copy in the registry stops it with `blob_corrupt` without installing anything.

`sync` also follows your teams: artifacts your teams require or install by default join the selected set, and artifacts no longer available to your teams leave it. An artifact marked as replaced gives way to its successor (`replaced <old> -> <new>` on stderr), and `install` of a replaced artifact prints a warning naming the successor. `uninstall` of an artifact your team requires needs `--force`.

`skillforge sync --into .claude --status active --prune` paginates the catalog, installs or updates matches, and with `--prune` removes lock entries (and files) that are not in the filtered set. `skillforge uninstall type/name --into .claude` deletes files, prunes empty directories up to but not including the install root, and drops the lock entry.

### Runtimes and scopes

`install`, `sync`, and `uninstall` accept `--runtime <id>` (`claude-code`, `codex`, `gemini`, `cursor`, `opencode`, `qwen`, `devin`, `reckon`; default `claude-code`) and `--scope project|user` (default `project`). The install root becomes that runtime's directory in the current project or in your home directory, for example `skillforge install skill/pdf-tools --runtime codex` writes `.codex/skills/pdf-tools/` and `.codex/.skillforge-lock.json`. Commands and agents are translated to the runtime's format; see [Agent support](getting-started/agent-support) for what each runtime accepts. The lock records the translated paths and the `runtime`. Without flags the CLI behaves as before (`.claude` in the current directory). `--into` keeps working and cannot be combined with `--runtime` or `--scope` (exit code 1). An unknown runtime exits with code 1 and lists the known ids.

Unsupported combinations exit with code 1 and a `not supported by <runtime>` reason (for example, publish a command as a skill for a runtime without slash commands; see [Agent support](getting-started/agent-support)). Hooks and plugins are never unpacked, because they install only in Claude Code through its plugin marketplace: `install` exits with code 1 and prints `/plugin install <plugin>@<marketplace>`, also with `--into`. `sync` does not fail on them: it exits 0 and lists them in `skipped` as `{ artifact, reason }` (JSON) or `skipped type/name: reason` lines. An `mcp-server` is not installed into agents yet: `install` exits with code 1 and says so, and `sync` lists it in `skipped`. See [Installing into your agent](getting-started/install) for the directory table of every agent.

When the author listed agents for an artifact, `install` compares the list with the target runtime (`claude-code` with `--into`). If the runtime is not listed, it prints `warning: <type>/<name> is declared for …; <runtime> is not in the list` to stderr; if it is listed with a minimum version, it prints `note: declared for <runtime> >= <version>`. The artifact is installed either way and the exit code does not change; with `--json` nothing is printed.


## Layers of edits

A company, a team or a person can keep their own edits over an artifact without copying it. A layer is a list of operations on the artifact's files — `append` text to the end of a file, `replace` a file, `add` a file — saved with `PUT /api/v1/artifacts/<type>/<name>/overlays/company` (admin), `…/overlays/team/<team>` (the team lead) or `…/overlays/me` (yourself); an empty `ops` list removes the layer. `skillforge install` and `sync` check the bundle signature, then apply the layers that concern you in order — company, your teams, your own — and record their fingerprint as `overlays` in the lock. A new version gets the same layers again, and a changed layer is applied by `sync` even without a new version. An operation on a file the new version no longer has is skipped with a warning. The artifact page lists your layers.

## Agents

Track a local agent directory as a named snapshot and compare it to the registry:

```bash
skillforge agent scan .claude --name laptop [--runtime claude-code] [--mcp]
skillforge agent status --name laptop
skillforge agent list
skillforge agent publish skill/local-notes --name laptop [--version 0.1.0] [--changelog "..."]
skillforge agent rm --name laptop
```

`scan` walks the directory (skips `node_modules` and `.git`), attaches `.skillforge-lock.json` as lock metadata, and prints `summary: local_only=N in_sync=N outdated=N modified=N registry_only=N` plus a table of items. Only files that make up artifacts are sent; the rest of the folder stays on your machine, and `scan` prints `not sent: N file(s) outside artifacts` (with `--json`, the paths in `not_sent`). Exit codes match the table above (missing `--name` or directory, or no artifact files in it → 1; conflict → 2; unauthorized → 4; unknown agent/item → 6). See `getting-started/agents` for statuses, server agents, and provenance.

`--mcp` is your consent, for this run only, to also read the MCP server configs of the runtime (Claude Code, Codex, Cursor, OpenCode): project files from the current directory (`.mcp.json`, `.codex/config.toml`, `.cursor/mcp.json`, `opencode.json`) and user files from your home (`~/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`, `~/.config/opencode/opencode.json`; `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are honoured). Only names, transport, package and pinned version, the origin of a remote address and the names of variables and headers are sent, never their values, arguments or paths. `scan` then prints `mcp: N server(s), U unpinned, S with literal secrets` and a table that marks `unpinned` and `literal secret: <names>`. Without `--mcp` no MCP config is opened. Other runtimes exit with 1.


## Project hints

`skillforge suggest [--dir <path>] [--accept] [--revoke] [--json]` suggests active registry skills for the project. It reads only names: dependencies from `package.json`, `requirements*.txt`, `pyproject.toml`, `go.mod` and `Cargo.toml`, file extensions (`.tf` gives `terraform`) and known files such as `Dockerfile` or `.github/workflows`. These signals are matched with artifact tags on your machine; the registry only receives the usual catalogue read, never the signals. The first run explains this and exits with code 2; `--accept` stores your consent in the CLI config and `--revoke` removes it. The result lists each skill with the matched signals and the install command. Authors make their skills findable by tagging technologies, for example `tags: [react, frontend]`.

## Skill drafts from your sessions

`skillforge harvest sessions --out <dir> --name <name> [--dir <logs>] [--min 3] [--json]` reads local Claude Code session logs (default `~/.claude/projects`) and keeps the rules you kept asking the agent for: sentences that start like a rule (`always`, `never`, `don't`, `avoid`, `use`…) and recur at least 3 times in at least 2 sessions. Only what you typed counts — not the agent's replies or tool output. It writes `<dir>/skills/<name>/SKILL.md` with the rules and the session file and line of each, and contacts no registry. Review the draft, then publish it as usual.

## Settings apply

`skillforge settings apply settings/<name>[@version] [--scope user|project|local] [--dry-run] [--json]` downloads a published settings profile (settings profiles are for Claude Code only) and merges its `settings.json` into the Claude Code settings file for the chosen scope (`user` -> `~/.claude/settings.json`, `project` -> `./.claude/settings.json`, `local` -> `./.claude/settings.local.json`). Objects merge recursively; arrays union without duplicates (existing order first); scalars take the profile value. Each change prints as `<path>: <old> -> <new>`. Before overwrite, a backup `<file>.bak-<YYYYMMDDHHmmss>` is written. `--dry-run` prints changes without writing. On success the CLI reminds you to Restart Claude Code. Non-settings artifacts and unreadable existing JSON exit with code 1.

## Plugin directory for Claude Code

`skillforge plugin-dir <type>/<name>@<version> [--url <base>] [--token <token>]` is what Claude Code runs for a `command` marketplace source (a registry on `http://` or `localhost`). It downloads `/api/v1/plugins/<type>/<name>/<version>.zip`, unpacks it into `~/.skillforge/plugins/<host>/<type>/<name>/<version>` (`SKILLFORGE_CACHE_DIR` overrides the root) and prints that folder as the only stdout line. A version already unpacked is printed without contacting the registry, because Claude Code re-runs the command at startup. You rarely call it yourself; see [Installing into your agent](getting-started/install).

## More commands

- `skillforge health` checks the server; `skillforge doctor` prints a health checklist, and an admin can download a diagnostics bundle with `--bundle`. `skillforge project status` compares the current project with the registry.
- `skillforge search <query>`, `skillforge list` and `skillforge info <type/name>` find artifacts and show their install commands; `skillforge suggest` proposes registry skills for this project from local signals and asks for consent first.
- `skillforge pack list` shows team method packs; `skillforge pack install <name[@version]> --role <role>` installs a pack, or one role of it, at its pinned versions.
- `skillforge evals push|run|runs|batch|batches|journal` manages eval suites and runs; `batch` runs one kind of eval across several runners.
- `skillforge runs list|show|watch`, `skillforge workflows list|save|run|trace` and `skillforge routines list|save|run|runs|disable` work with recorded runs, workflows and scheduled routines.
- `skillforge teams list|show|create|add|remove|scope|labels` manages teams, an artifact's visibility scope and registry labels.

## Exit codes and JSON

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 1 | Validation or bad input |
| 2 | Conflict (version/digest) |
| 3 | No registry configured or unreachable (`SKILLFORGE_URL` / `skillforge login --url`) |
| 4 | Unauthorized or forbidden (`skillforge login`) |
| 5 | Local changes blocked install |
| 6 | Not found |

Pass `--json` for machine-readable stdout (no colors). Errors always go to stderr.

> [!TIP]
> Use these codes to gate pipelines without scraping human text.