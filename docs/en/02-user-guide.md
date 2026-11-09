# User guide

SkillForge is a self-hosted internal registry of artifacts for AI agents:
skills, commands, agents, hooks, plugins, settings profiles, and descriptions of
approved MCP servers. The registry stores versioned content, manages lifecycle
and channels, computes quality and metrics, and delivers artifacts to agent
runtimes (Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Qwen Code, Devin,
Reckon) via the CLI and MCP. This guide is a tour of the whole product; each
section links to the page with the details. Support table: help topic
`getting-started/agent-support` and [Agents](agents/README.md).

## 1. Concepts

- **Artifact** — a registry unit with a name, a type, and a version history.
  Types: `skill`, `command`, `agent`, `hook`, `plugin`, `settings`, `mcp-server`
  ([Artifact types](05-artifact-types.md)).
- **Version** — an immutable content snapshot with a semver version, a digest
  (sha256), and provenance (where it came from). A version is never overwritten.
- **Version channel** — every version is in exactly one channel, `stable` or
  `beta`. A version with a pre-release suffix (`1.2.0-beta.1`) is always `beta`;
  any other version is `stable` unless it is published or moved to `beta`.
  `latest` is the highest `stable` version, or the highest version overall
  when there is no stable one; installs follow `latest`
  ([Versions and channels](10-versions-and-channels.md)).
- **Lifecycle status** — belongs to the artifact, not to a version:
  `candidate` (newly published, waiting for review), `active` (endorsed),
  `aging` (no activity for too long), `zombie` (marked as unused or stale),
  `retired` (withdrawn). Allowed transitions: `candidate` → `active` or
  `retired`; `active` → `aging`, `zombie` or `retired`; `aging` → `active`,
  `zombie` or `retired`; `zombie` → `active` or `retired`; `retired` →
  `candidate`. Manual transitions require a reviewer or admin. A candidate that
  waits longer than `SKILLFORGE_CANDIDATE_TTL_DAYS` (30 by default) stays a
  candidate; it is only flagged `stale_candidate` on the cleanup list
  ([Lifecycle and review](07-lifecycle-and-review.md),
  [Lifecycle by data](08-lifecycle-by-data.md)).
- **Visibility** — `org` (everyone, including anonymous catalog browsing) or
  `team` (members of `owner_team` plus reviewer+).
- **Roles** — `viewer` (read), `contributor` (publish, comments, channels,
  agents), `reviewer` (lifecycle, version validation, evals, moderation),
  `admin` (users, backups, plugins, server agents, purge, policies and the
  admin pages in §10).
- **Ownership** — an artifact has an `owner` (the first publisher) and optional
  `maintainers`/`owner_team`. Only an admin may change another user's ownership
  ([Teams, visibility and ownership](11-teams-visibility-ownership.md)).

The [Glossary](glossary.md) defines every term used in these pages.

## 2. Sign-in and profile

- Sign-in: `/login` (local password; LDAP/OIDC when configured by the operator).
- `/me/password` — change password; `/me/tokens` — API/MCP tokens for CLI
  and agents;
- `/me/notifications` — notification feed and per-kind preferences
  (`notif-pref-*`); the header bell shows the unread count;
- `/me/agents` — my local agents (scan of an agent folder: `.claude`, `.codex`,
  `.cursor`, …; publish from snapshot); `/me/agents/:name` — details.

## 3. Catalog and artifact page

- `/artifacts` — search, filters by type/status/team/labels, pagination.
- `/artifacts/:type/:name` — the card: name, type, status, version, channels
  (`stable x.y.z`, `beta x.y.z`), visibility, labels, digest, description.
- Tabs:
  - **Overview** — metadata, data signals (sessions, usage);
  - **Files** — files of the selected version;
  - **Versions** — version list: channel, author, digest, changelog,
    validation mark; actions `set-channel`, `validate`, `purge-version`;
    **Compare versions** shows added, removed and changed files with a line
    diff (`GET …/diff`);
  - **Comments** — threads with replies, `@mentions`, edit and soft-delete;
    version filter;
  - **Evals** (skill, managers only) — eval suite, runs, journal, gate;
  - **Workflows / Routines** (skill, managers only) — orchestration flows and
    schedules, shown only when orchestration is enabled;
  - **Install** — install commands for the selected runtime;
  - **Quality** — `Q_*` signals plus hook/duplicate heuristics; the built-in
    security scan (pass / warn / fail, also a risk chip in the catalog);
    context cost — tokens on every turn (name and description), when used
    (body) and on demand (other files), with a "Costly context" chip for a
    high level; the score against company and team quality rules;
  - **Evidence** — review output and other evidence on the version;
  - **Audit** — event log (publish, transitions, channels, metadata, purge);
  - **ext-*** — plugin-provided tabs (e.g. review-assistant).
- Also on the page: **Availability for teams** (§6), **Save successor**
  (the artifact is replaced by another one of the same type: the catalog card
  shows **Replaced**, `sync` moves people to the successor) and your layers of
  edits (§5).

## 4. Publishing and import

All upload routes, their steps and common errors are in the help topic Uploading
artifacts (`getting-started/upload-artifacts`) and in
[Publishing and import](06-publishing-and-import.md).

- From GitHub or another git host — `/import`, source `git`. There is no CLI command
  for Import. The server does the cloning, so it needs the access to the repository.
- From your agent's folder — `skillforge agent scan .claude --name laptop`, then
  `skillforge agent publish skill/my-skill --name laptop` or the button in `/me/agents`.
  Only artifact files leave the machine; `--mcp` also reports the agent's MCP servers
  (names and versions, never values) to the inventory.
- One package or CI — `/publish` or `skillforge publish`.
- MCP cannot upload, and a token with the MCP option does not work for uploads.
- `/publish` — file/directory upload; contributor+.
- `/import` — zip bundle, git repository, or directory: candidate preview,
  conflicts (including `not_owner`), selective run with `skip_conflicts`.
- The first publish of a name creates the artifact as `candidate`; agents see
  it after a reviewer promotes it to `active`. The author of the latest
  version cannot promote it themselves. A later version does not change the
  artifact's status: a new version of an `active` artifact stays `active` and
  is not reviewed again. To let volunteers try a change first, publish it to
  the `beta` channel.
- Contracts: name/type come from frontmatter (`name:`) or structure;
  re-publishing identical content → `digest_exists`; same version →
  `version_exists`.
- `provenance` in the publish body records the source (import, reckon run, …)
  and lands in the append-only ledger (`GET /provenance`), shown on the card.
- Admin policies may refuse a version: a failed security scan when the
  security policy blocks (`E_SECURITY_BLOCKED`), a score below the company
  quality rules in block mode (`E_RUBRIC_BLOCKED`).
- Import is limited by the admin's **source policy** (allowed git sources,
  zip and folder uploads on or off: `import_source_not_allowed`,
  `import_archives_disabled`) and the **quarantine** of fresh commits
  (`import_too_fresh`: a commit younger than the minimum release age, counted
  from when the registry first saw it). Admins also keep **mirrors** of
  external git sources on `/import`: new packages arrive as candidates,
  changed ones as a new `beta` version.

## 5. Installing into agents

Via the `skillforge` CLI after `skillforge login`:

```bash
skillforge list --status active           # catalog
skillforge search <query>
skillforge install <type>/<name>[@version] --runtime <id> [--scope project|user]
skillforge sync                           # reconcile installed with registry
skillforge uninstall <type>/<name> --runtime <id>
skillforge whoami                         # check sign-in
skillforge suggest                        # registry skills that match this project
skillforge pack install <name>[@version] [--role <role>] --runtime <id>
skillforge harvest sessions --out <dir> --name <name>
```

- **Checks on install.** `install` and `sync` verify the registry's
  signature of each version: an unsigned version installs with a warning, a
  changed or extra file or a changed signing key stops the install. A version
  whose security scan failed is refused unless you add `--allow-risky`; a
  **warn** verdict only prints a warning. `install` of an artifact that is not
  available for your teams and `uninstall` of one your team requires need
  `--force`. `install` of a replaced artifact warns and names the successor;
  `sync` installs the successor and removes the replaced one.
- **Layers of edits (overlays).** A company (admin), a team (its lead) or you
  can keep edits over an artifact — append to a file, replace a file, add a
  file — with `PUT …/overlays/company|team/<team>|me`. `install` and `sync`
  apply the layers that concern you after the signature check, in the order
  company → your teams → you, so the edits survive updates; a changed layer
  is applied by `sync` without a new version. The artifact page lists your
  layers.
- **Hints for a project.** `skillforge suggest` reads only file and
  dependency names of the project (package.json, go.mod, Dockerfile, file
  extensions and similar), keeps them on your machine and lists active
  registry artifacts whose tags match those signals. It runs only after
  consent: `--accept` agrees, `--revoke` withdraws.
- **Method packs.** `/packs` lists team method packs: a versioned set of
  roles, each with artifacts at pinned versions.
  `skillforge pack install team-method@1.0.0 --role developer` installs one
  role (all roles without `--role`); `sync` keeps the pinned versions, installing a
  newer pack version moves them. `skillforge pack list` lists packs.
- **Skills from your sessions.** `skillforge harvest sessions` collects rules
  you keep asking your agent for from local Claude Code session logs (only
  your own words) and writes a skill draft on disk; it sends nothing. Review
  the draft and publish it as usual.
- The `.skillforge-lock.json` lock file pins versions/digests in the project;
  local edits are detected by `sync` (dirty check).
- Runtimes (`RuntimeId`): `claude-code`, `codex`, `gemini`, `cursor`,
  `opencode`, `qwen`, `devin`, `reckon`. Not every type installs into every
  runtime — see [Agents](agents/README.md), `getting-started/agent-support` and
  the reason returned by `skillforge install … --runtime …`. Skills install into
  all eight; agents also into Codex (`.codex`), Cursor, OpenCode, and Qwen Code;
  hooks, plugins, and settings profiles remain Claude Code only (hooks and
  plugins install through the Claude Code plugin marketplace, `/plugin install`).
- `skillforge settings apply` — settings profiles (Claude Code only).
- `mcp-server` — an approved MCP server: not installed into agents yet; configure it
  by hand as its artifact page shows. Admins set the MCP policy on `/admin/lifecycle`.
- MCP server: `skillforge mcp` — a stdio bridge that gives the agent read access
  to the registry ([MCP](13-mcp.md)).

## 6. Teams and visibility

- `/teams` — team list (membership visible to members and admin);
  `/teams/:name` — details: members (`member`/`lead`), team artifacts.
- Team creation is admin; `lead` is assigned at creation.
- An artifact can be narrowed to a team (scope `team` + `owner_team`) — by the
  owning member, the lead, or admin; widening back to `org` takes the same set
  of rights.
- **Availability for teams** on the artifact page sets, per team: not
  available, available (default), installed by default, or required. Admin
  for any team, a lead for their own; every change is audited. `sync`
  installs what your teams require or install by default and never installs
  unavailable artifacts; for someone in several teams the most permissive
  state wins.

Details: [Teams, visibility and ownership](11-teams-visibility-ownership.md).

## 7. Lifecycle

- `/lifecycle` — reviewer+/admin page: review queue (`candidate`), deletion
  boards (`aging`, `zombie`, recently `retired`), and the cleanup list (zombies,
  artifacts the data rules would move, stale candidates).
- On the card — the `lifecycle-panel` with the current status and transition
  buttons for reviewer+ (a reason is required for `retired` and `zombie`).
- Automatic moves (`active` → `aging`, `active`/`aging` → `zombie`, `aging` →
  `active` by renewed use) come from usage data; automation never retires or
  purges ([Lifecycle by data](08-lifecycle-by-data.md)).
- Channel moves (**Promote to stable**, **Move to beta**) happen on the Versions
  tab through a confirmation dialog; the eval gate may block promotion to
  `stable` (see §8).

## 8. Quality, evals, and evidence

- **Quality** tab — `Q_*` signals (structure, tool safety, metadata), hook
  heuristics, and duplicate similarity
  ([Quality and security](09-quality-and-security.md)).
- **Evals** tab (skills): case editor (`trigger`/`task`, checks, `holdout`),
  `Save suite`, run launcher (kind/version/scope/runner), per-version journal,
  `gate: required` — an acceptance gate for the stable channel (requires at
  least one holdout case; only reviewer+/admin can turn it off).
- **Cost per solved task** (Evals tab) — for the latest compare and ablation
  run of each runner: solved tasks, tokens, cost and cost per solved task,
  cheapest per solved task first. Runners report usage, or the operator gives
  each runner a model and a price in the runners file
  ([Skill evals](17-skill-evals.md)).
- **Evidence** — per-version evidence: review-assistant output, a link or a
  text document (up to 64 KiB), ablation results and more.
- **Workflow gates** — a workflow step can wait for a person's approval, a
  review loop has a bounded number of rounds, a failed run can be resumed;
  the `epic-with-gates` template builds plan → approval → implement ↔ review →
  release approval.
- **Orchestration** — workflows, routines, hook runtime, run outputs, overhang
  detection, and the eval orchestrator. Workflows, routines and the hook
  runtime are operator-gated (`SKILLFORGE_ORCHESTRATION_ENABLED`, default
  OFF): when off, their API answers `403 feature_disabled` and the
  Workflows/Routines tabs are hidden. Security model, roles, MCP restrictions
  and kill switches — [Orchestration](18-orchestration.md).

## 9. Metrics

`/metrics` — dashboard: totals (artifacts, sessions, transfer, ablation),
filters (q/type/status/team), pagination, CSV/JSON export (signed-in only).
For management (admin): `/admin/report` — use by consuming team and by
artifact over a period, the trend, a context token estimate and the artifacts
nobody used. Definitions: [Metrics dashboard](15-metrics-dashboard.md); how
session usage is collected: [Session metrics](16-session-metrics.md).

## 10. Administration (admin)

- `/admin/users` — users: create, roles, disable, password reset; artifacts
  without an owner (their owner was disabled) with **Hand over**.
- `/admin/backups` — backups: create, download, delete. A backup holds the
  signing key and the plugins too, so keep it as a secret
  ([Backups and operations](20-backups-and-operations.md)).
- `/admin/plugins` — installed extension plugins ([Server plugins](14-plugins.md)).
- `/admin/agents` — server agents (roots, rescan, removal).
- `/admin/lifecycle` — lifecycle policies, the security policy for the
  content scan, company quality rules.
- `/admin/audit` — one audit log (artifact and system events), filters,
  NDJSON export and a cursor for a SIEM.
- `/admin/report` — report for management (§9).
- `/admin/inventory` — what stands on people's machines, from agent
  snapshots: own, imported and unknown artifacts, copies that differ from
  the registry ([Agents and inventory](12-agents-and-inventory.md)).
- `/admin/rollout` — open a pull request with active artifacts in chosen
  GitHub repositories (needs `SKILLFORGE_GITHUB_TOKEN` on the server).
- `/admin/harvest` — rules that recur in pull request review comments,
  turned into a candidate skill draft (same GitHub token).
- `/admin/assistant` — the LLM connection for the help assistant and for
  skill validation by the model.
- Purge — irreversible erasure of a version or artifact
  ([Metadata and purge](19-metadata-and-purge.md), recipe in the
  [Cookbook](21-cookbook.md)).

## 11. Built-in help

`/help` — the help center covering pages and actions; `?` (HelpTip) buttons
next to controls open the matching topic. Error codes are documented under
`help/codes/`.

## See also

- [Why SkillForge](01-why-skillforge.md)
- [Self-hosting](03-self-hosting.md)
- [Role handbooks](handbook/README.md)
- [Cookbook](21-cookbook.md)
- [Manual test cases](22-manual-test-cases.md)
- [Glossary](glossary.md)
