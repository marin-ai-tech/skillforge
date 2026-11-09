# Cookbook

Practical how-to recipes for common tasks, each a few steps long. Contract
details live in the [User guide](02-user-guide.md), the numbered reference
pages and the built-in `/help`.

## 1. First run: a working registry in 5 minutes

1. `npm run local:start` → open `http://127.0.0.1:8787`, sign in as `admin`
   (password printed to console or set via `SKILLFORGE_ADMIN_PASSWORD`).
   For Docker and the Windows installer see [Self-hosting](03-self-hosting.md).
2. `/start` — checklist: change password, install the starter pack, promote
   candidates to `active` with batch promote.
3. Create roles: `/admin/users` → `rev1` (reviewer), `dev1` (contributor),
   `viewer1` (viewer).

## 2. Publish a skill from a directory

```bash
skillforge login --url http://127.0.0.1:8787 --username dev1 --password-stdin
skillforge publish ./my-skill            # name from frontmatter name:
```

Or the UI: `/publish` → files. Republishing identical content → `digest_exists`
(expected — no new versions). Bump the version: `--version 0.2.0`, or just edit
content — the version is auto-picked (patch).

The first publish creates the artifact as `candidate`. A later version keeps the
artifact's status: a new version of an `active` artifact is available at once
through the `stable` channel, unless you publish it to `beta`
([Versions and channels](10-versions-and-channels.md)).

## 3. Install a skill into your agent

Pick the agent with `--runtime` (default `claude-code`); the CLI puts the files where that agent reads them:

```bash
cd <project>
skillforge install skill/pdf-tools --runtime claude-code   # .claude/skills/pdf-tools/
skillforge install skill/pdf-tools --runtime codex         # .codex/skills/pdf-tools/
skillforge install skill/pdf-tools --runtime gemini        # .gemini/skills/pdf-tools/
skillforge install skill/pdf-tools --runtime cursor        # .cursor/skills/pdf-tools/
skillforge install skill/pdf-tools --runtime opencode      # .opencode/skills/pdf-tools/
skillforge install skill/pdf-tools --runtime qwen          # .qwen/skills/pdf-tools/
skillforge install skill/pdf-tools --runtime devin         # .agents/skills/pdf-tools/
skillforge install skill/pdf-tools --runtime reckon        # .reckon/skills/pdf-tools/
# + .skillforge-lock.json
```

`--scope user` installs into the agent's user folder (for example `~/.claude`, `~/.codex`,
`~/.config/opencode`) — across all projects. Devin and Reckon have the project scope only.
Per-runtime details: [Agents](agents/README.md).

## 4. Commands, agents, hooks, and settings: what installs where

Limits (see `getting-started/agent-support`): `command` — Claude Code as is,
gemini/cursor/opencode/qwen with format translation (Cursor: project scope only);
`agent` — Claude Code, Codex (`.codex/agents/*.toml`), Cursor, OpenCode, Qwen Code;
for the other runtimes the command returns the refusal reason. Reckon supports skills
only; flat "learned" skills that Reckon writes itself are never touched.

Hooks, plugins, and settings profiles are Claude Code features: hooks and plugins install
through the Claude Code plugin marketplace (`/plugin install <plugin>@skillforge`, Claude
Code only), settings profiles with `skillforge settings apply` (Claude Code only).
See [Artifact types](05-artifact-types.md).

## 5. Connect the registry to an agent via MCP

1. `/me/tokens` → create a token with the **MCP** flag (optionally limited by tags); pick your client
   (Claude Code, Codex, Cursor, OpenCode, Qwen Code) and the page shows the ready command to connect.
2. Run it, for example over HTTP in Claude Code:

```bash
claude mcp add --transport http skillforge http://127.0.0.1:8787/mcp --header "Authorization: Bearer <MCP token>"
claude mcp list   # skillforge: … Connected
```

Or over stdio through the CLI bridge: `claude mcp add skillforge -e SKILLFORGE_URL=<url> -e SKILLFORGE_TOKEN=<MCP token> -- skillforge mcp`;
the same bridge in Codex: `codex mcp add skillforge --env SKILLFORGE_URL=<url> -- skillforge mcp` (token from
`skillforge login`). Any other MCP client connects over HTTP `<url>/mcp` with `Authorization: Bearer <MCP token>`;
commands for every client — help topics `getting-started/mcp` and `getting-started/agent-support`, and [MCP](13-mcp.md).
`skillforge mcp` is the stdio bridge itself, not a config printer. A regular API token is refused with
`mcp_not_allowed`. The agent can search and read `active` artifacts only.

## 6. Sync installed artifacts with the registry

```bash
skillforge sync   # updates changed versions, reports local edits (dirty)
```

Local edits to installed skill files are flagged dirty and `sync` stops (exit code 5); `--force` overwrites them.
`skillforge outdated` shows which installed artifacts have newer versions (`sync` has no `--dry-run`).

## 7. Create a team and narrow an artifact's visibility

1. admin → `/teams` (or API) → team `alpha`, lead `dev1`.
2. The owner opens the artifact card → Scope panel → `team`, `alpha`.
3. Verify: an outsider gets 404/NotFound; members and reviewer+ get full access.

Details: [Teams, visibility and ownership](11-teams-visibility-ownership.md).

## 8. Move a version between channels

Every version is in `stable` or `beta`. A version with a pre-release suffix
(`0.3.0-beta.1`) is always `beta`; any other version is `stable` unless it was
published with `"channel": "beta"` (or the eval gate put it there).

**Versions** tab: `Promote to stable` on a beta version → confirm → `stable`
badge, and `stable x.y.z` on the card; `Move to beta` on a stable version →
confirm → it leaves `latest` without being deleted. With `gate: required` and a
failing gate, promotion to stable returns an error linking to the Evals tab.

## 9. Promote a candidate to active

reviewer+ → `/lifecycle?tab=review` → promote on the candidate card → optional
reason → status `active`. The author of the latest version cannot promote it.
Reverse path: `retired` requires a reason and writes audit; a retired artifact
can be restored to `candidate`. See [Lifecycle and review](07-lifecycle-and-review.md).

## 10. Set up evals and enable the gate

1. Artifact card → **Evals** → `Add trigger case` (or `task` with checks) →
   mark at least one `holdout` → `Save suite`.
2. Run: pick kind/version/scope → `Run` (requires runners —
   `SKILLFORGE_EVAL_RUNNERS_FILE`, otherwise a clear error).
3. `Gate: required` — new versions land on `beta` and promotion to `stable`
   needs a passing holdout comparison. Details: [Skill evals](17-skill-evals.md).

## 11. Import a bundle from zip

`/import` → zip → candidate preview with conflicts → select → Run. The
`not_owner` conflict is visible before the run; `skip_conflicts` skips the
failures and publishes the rest. See [Publishing and import](06-publishing-and-import.md).

## 12. Register a local agent and publish from it

1. `/me/agents` → add an agent folder (`.claude`, `.codex`, `.cursor`, … or a runtime root) → scan.
2. Pick artifacts in the snapshot → Publish. A new name lands as `candidate`; a
   new version of an existing artifact keeps that artifact's status.
3. Files deleted later in the snapshot do not delete what was published.

See [Agents and inventory](12-agents-and-inventory.md).

## 13. Remove a leaked secret (purge)

1. First revoke the secret with the provider (purge does not revoke external
   tokens).
2. admin → card → `Purge version`/`Purge artifact` → reason of 10–500 characters
   (never the secret itself) → exact confirm `type/name[@version]` → (optional)
   delete backups. CLI: `skillforge purge <type/name[@version]> --reason <text> --confirm <type/name[@version]> [--delete-backups]`.
3. Cascade: blobs, comments, notifications, evals, audit redaction, evidence,
   sessions/usage, run outputs, provenance entries. Content in pre-existing
   backups remains unless the checkbox is selected.

Details and limits: [Metadata and purge](19-metadata-and-purge.md).

## 14. Export metrics

`/metrics` → filters → `CSV`/`JSON` → download (signed-in only). CLI:
`skillforge metrics --csv`. See [Metrics dashboard](15-metrics-dashboard.md).

## 15. Keep track of an artifact

On the card — `watch`: notifications about new versions/status go to the bell
and `/me/notifications`. An `@username` mention in a comment notifies directly.

## 16. Uninstall

```bash
skillforge uninstall skill/pdf-tools --runtime codex   # the same --runtime and --scope as at install
```

Removes files and the lock-file entry; the registry is untouched.

## 17. Enable orchestration and run a workflow

1. The operator sets `SKILLFORGE_ORCHESTRATION_ENABLED=true` and restarts
   the server (kill switches and the security model — [Orchestration](18-orchestration.md)).
2. An admin opens the artifact card → **Workflows** tab → saves the JSON step
   definition. Anyone who manages the artifact can then `Run` it. At most 10
   active runs per artifact (`429 queue_full`).
3. Scheduling — the **Routines** tab: POSIX cron (`N/S` = `N..max` stepped;
   `dom|dow` = "either"), `Run now` fires off-schedule; output lands in
   run-outputs.

## See also

- [User guide](02-user-guide.md)
- [Role handbooks](handbook/README.md)
- [Manual test cases](22-manual-test-cases.md)
- [Glossary](glossary.md)
