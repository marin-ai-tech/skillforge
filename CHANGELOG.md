# Changelog

All notable changes to SkillForge. Versions follow [Semantic Versioning](https://semver.org/); while the major version
is 0, a minor version may change behavior.

## 0.5.22 — 2026-11-20

### Added
- The `codealive` starter pack has six more skills: `pragmatic-verification`, `agentic-readiness`,
  `mcp-management`, `plugins-management`, `repo-activity-summary` (CodeAlive-AI/ai-driven-development) and
  `maintaining-vcs-hygiene` (CodeAlive-AI/jj-agentic-workflow), eighteen in all. They are copied unchanged; reinstalling
  the pack adds the six as candidates and reports the twelve already installed as `exists`.
- News: the checkbox **Only my artifacts** above the feed keeps only the news about artifacts you own, co-author or
  watch. It is shown to a signed-in reader, kept in the address as `mine=1`, and like the other filters hides the
  pinned posts and the separator **Earlier — already seen**.

### Changed
- Boolean query flags accept `true`/`1` and `false`/`0` on every route; any other value is `400`.
- Form fields have a stronger border (3:1 against the background in the light and dark themes).
- News: **Earlier — already seen** stands right after the last item newer than your previous visit, your own recent
  actions included. Before, it was placed by counting the unread items down the list, so an unread pinned post or
  your own actions moved it and already seen news looked new.
- `POST /api/v1/news/seen` also answers `previous_seen_at`: the mark before this call, `null` when there was none.
- A bundle may hold up to 4000 files and 64 MiB (was 1000 and 32 MiB).

### Fixed
- A failing background task (routine schedule, evaluation batches, aging sweep, import cleanup, mirror and source
  checks) writes `background_task_failed` to the server log instead of failing silently; the same error in a row is
  written once.

## 0.5.21 — 2026-11-20

### Fixed
- A git import of one folder failed on Windows with "Filename too long" when another folder of the repository had
  long paths: the server checked out the whole repository. Now only the folder (and the files at the repository root)
  is written to disk, and every clone allows long paths. The same applies to mirrors and tracked sources checked
  through git. Git import of a folder needs git 2.27 or newer on the server.

## 0.5.20 — 2026-11-19

### Fixed
- The Source panel of an artifact kept saying "New beta version for review" after that version was moved to stable
  (or deleted), until the next check of the source. The badge now says "New version from the source", and the note
  names the version's channel as it is now: in beta for review, stable, or deleted.

## 0.5.19 — 2026-11-19

### Fixed
- The `skillforge mcp` stdio bridge works after a regular `skillforge login`. The CLI now keeps a separate MCP token:
  save it once with `skillforge login --url <server> --mcp-token-stdin` (the first line of stdin, checked against
  `/mcp`). The bridge uses it, while `install`, `sync` and other commands keep the regular token. Before, the bridge
  sent the regular token and got `mcp_not_allowed`, and logging in with the MCP token broke `install` and `sync`.
- The tokens page names that command in the stdio note for every client.

## 0.5.18 — 2026-11-19

### Added
- News: one feed for the whole registry on `/news`, a **News** item in the header with the count of what is new
  since your last visit, and **What's new** on Home. The registry writes an item when an artifact first becomes
  active, a stable version that is not the first one appears, or an artifact turns zombie, is retired or comes back;
  beta versions, moves to aging and candidates make no news. An admin posts for everyone or any team, a team lead
  for their own team: drafts, scheduled publication, expiry, pinned and important posts, all in the audit log.
  Every item is shown only to those who may see its artifact or its team, checked on each read.
- News outside the web page: a daily or weekly news summary (a notification and the `news.summary` event for
  plugins), the `news.published` event for every item, an Atom feed (`/api/v1/news.atom`, and a personal link that
  opens only the feed, shown once, replaced or revoked in the cabinet), `skillforge news` and `skillforge news
  seen` in the CLI, and the MCP tool `list_news`, which also tells an agent that a skill it uses was retired and
  what replaces it. `GET /api/v1/news` takes `since` and `unread=true` and returns `seen_at`. New setting
  `SKILLFORGE_NEWS_TICK_MS`.

## 0.5.17 — 2026-11-18

### Fixed
- Tracked sources from a large GitHub repository never updated without `git` on the server: the archive transport
  counted the import limits over the whole repository (here 2354 files) instead of the source's folder (36), and
  refused a link anywhere in it. Now only the folder is read and counted (5000 files, 64 MB); a link outside the
  folder is skipped, an unsafe path anywhere still fails the check.
- A stalled download, an archive over 64 MB unpacked or a broken one failed as an unnamed `check_failed` with nothing
  in the log. They are now `github_unreachable`, `archive_too_large` and `archive_broken`; the download may take 5
  minutes; an unforeseen error is logged as `source_check_failed` or `mirror_check_failed`.
- The background check of mirrors and tracked sources ran a full `SKILLFORGE_MIRROR_INTERVAL_HOURS` after start,
  so every restart put it off. It now goes by due date: 5 minutes after start and then hourly, it checks what was
  last checked longer ago than the interval, and passes never overlap.

## 0.5.16 — 2026-11-16

### Fixed
- The `sdlc-registry` plugin credited the wrong roles in `report_outcome`: it matched the gate id of
  `gate.<gate>.<outcome>` (intent, spec, plan, …) against the roles' stages. It now takes the stage from the event's
  `stage` field (sdlc 0.32.1) or maps the gate to its stage (intent → plan, spec → design, plan → build, verify and qa
  → test, review and release → deploy); the plan gate credits the build-stage roles, not the plan-stage ones.

## 0.5.15 — 2026-11-15

### Added
- Reviewers and admins see **Agents and models in evals** at the bottom of `/metrics`
  (`GET /api/v1/evals/summary`): one row per eval runtime across the registry, from the latest ablation run of each skill,
  with the share solved with and without the skill, the uplift and the cost per solved task. Without eval runs the section
  explains how to set them up.

## 0.5.14 — 2026-11-15

### Added
- `skillforge sessions import` sends the model that called a skill (`message.model` in Claude Code, `modelID` in
  OpenCode); `--no-model` leaves it out. The artifact card's metrics show a **By model** table (`by_model`): a model is
  named only when at least two people in the registry reported it. Importing again fills in the model of facts
  sent before, without counting them twice.

### Compatibility
- Session facts accept an optional `model`; a malformed one is dropped and the fact still counts. Older CLIs send
  no model; older servers drop it. Migration `0054` adds the column `session_facts.model`.

## 0.5.13 — 2026-11-15

### Added
- The artifact card's metrics tab shows session usage **by agent** (`by_runtime` in
  `GET /api/v1/artifacts/:type/:name/metrics`): sessions, users, verification pass rate and last use per agent the
  facts were imported from. A source that is not a known agent goes to one "Other sources" row and is not shown; a
  row of one user hides its pass rate when the skill has more users.

## 0.5.12 — 2026-11-14

### Added
- Rules for Codex, Gemini CLI and Qwen Code: `skillforge install` and `sync --type rule --runtime codex|gemini|qwen`
  keep the rule in `.<agent>/skillforge/rules/` and write one SkillForge block into `AGENTS.md`, `GEMINI.md` or
  `QWEN.md` in the project root. Text outside the block (including the sdlc process-rules block) is not changed; a
  hand edit inside the block or broken markers stop the command before any write (`--force` rebuilds the block);
  uninstalling the last rule removes the block. Warnings for the Codex 32 KiB `AGENTS.md` limit and for a rule that an
  agent would read twice.

### Compatibility
- `install rule/... --runtime codex|gemini|qwen` used to exit with code 1 and `sync` skipped the rules; they now
  install. The user scope is still refused.

## 0.5.11 — 2026-11-14

### Fixed
- `/admin/plugins` lists the MCP tools of each loaded plugin, marks the ones for integrations, says which plugins add
  MCP tools once enabled, and after disabling says the MCP tools are already off.
- On a narrow screen the plugin description column no longer shrinks to a sliver.

### Compatibility
- `GET /api/v1/admin/plugins` has a new `contributions.mcp_tools` list; other fields are unchanged.

## 0.5.10 — 2026-11-14

### Fixed
- A settings profile with a path under a `_FILE`, `_PATH` or `_DIR` variable in `env` (such as `GITHUB_TOKEN_FILE:
  /run/secrets/gh`) is no longer refused as a literal secret; MCP configs and profiles share one rule.
- The agent page shows a file built from a registry artifact as **built from** `type/name@version` with a link to
  that artifact, instead of a link to a page that does not exist, a Publish button and an install command for its
  local name.

### Added
- Plugins can add MCP tools (`ctx.mcp.tool`, capability `mcp`): they appear on `/mcp` next to the built-in tools
  and read the registry only as the calling token. A tool marked for integrations is seen only by an integration
  token (`integration: true`, **For an integration, not an agent** on the token page).
- The built-in `sdlc-registry` plugin answers sdlc's team registry (`list_roles`, `get_role`, `list_skills`,
  `get_skill`, `list_rules`, `get_rule`) on SkillForge's `/mcp`, so sdlc needs no adapter; `report_outcome` (integration
  tokens only) records sdlc stage outcomes as `assigned` usage. It is off until an administrator turns it on.
- A plugin manifest may set `enabled_by_default: false`: the plugin is recorded disabled when first seen.

### Documentation
- README screenshots and the animated tour show the current interface (language switch, the Rules tab).
- README, docs and in-app help list rules among the artifact types and in the agent support tables, say that
  `harvest` drafts a rule by default, list five MCP tools, and describe `sync` with local edits as it works now.
- The Publish page subtitle no longer lists only four of the eight types.

### Compatibility
- Migration 0053 adds the integration flag to API tokens (default off); existing tokens behave as before.
- Release archives and the image carry the `sdlc-registry` plugin; it is recorded disabled when first seen, so nothing
  changes until an administrator turns it on on `/admin/plugins`.
- MCP `tools/list` also lists the tools of enabled plugins with the `mcp` capability.

## 0.5.9 — 2026-11-14

### Added
- Rules install into OpenCode: `skillforge install rule/<name> --runtime opencode` (and `sync`) writes
  `.opencode/rules/<name>.md` and adds `.opencode/rules/*.md` once to `instructions` in the project's OpenCode config,
  keeping its comments and other keys; a config it cannot read stops the install with the line to add by hand.
- `skillforge sessions import --harness opencode --root <dir>` counts skill use from OpenCode session exports
  (`opencode export`), with the same four-field facts as for Claude Code.
- MCP tool `read_artifact_files`: every file of a version in one call, with files over the limits listed in `omitted`.
- A file built from a registry artifact can name it in front matter (`skillforge-source: <type>/<name>@<version>`);
  `agent scan` then compares it with that artifact instead of showing it as `local_only` and the source as
  `registry_only`.

### Fixed
- `agent scan --mcp` no longer flags a path under a `_FILE`, `_PATH` or `_DIR` variable (such as
  `SKILLFORGE_TOKEN_FILE`) as a literal secret.

### Compatibility
- `install` and `sync` of a rule with `--runtime opencode` used to refuse or skip it; now they install it and may create
  or edit the project's `opencode.json`.
- MCP `tools/list` has five tools. The database gets a column for the source marker (migration 0052).

## 0.5.8 — 2026-11-13

### Security
- A file whose name says it holds a secret (`.env`, a private key or key store, a credentials file such as
  `auth.json` or `settings.local.json`) never becomes part of a version. The CLI and the Publish page stop before
  anything is sent, the registry refuses it with `E_SECRET_FILE` on every path (publish, import, mirrors, tracked
  sources), and agent snapshots leave it on the machine. Templates such as `.env.example` are allowed.

### Fixed
- `skillforge sync` no longer stops on one artifact it cannot install (a forged signature, a damaged file): it lists
  it in `failed`, installs the rest and exits with the worst code among the failures.
- An anonymous browser tab no longer asks for the session every second, and a signed-in user no longer sees
  **Sign in** flash while the page loads.
- `skillforge publish` of an existing version prints one message with the code and the next step instead of the bare
  code twice. Notification titles and kind labels are written in the reader's language.
- `npm run seed:demo` works again on a fresh local registry.
- `skillforge agent scan --runtime reckon` run from inside `.reckon` finds the learned skills.
- Help: provenance sources, what a new version does to the artifact's status, the `scope` and `labels` commands,
  the OpenCode files read by `--mcp`, how review runs start, and what "imported" means in the inventory.

### Compatibility
- A publish or an import that carried such a secret file and passed before is refused now; a mirror or a tracked
  source with one gets `failed` with `E_SECRET_FILE`. Already published versions stay as they are.
- `skillforge sync --json` has a new `failed` list.

## 0.5.7 — 2026-11-13

Steadier tests and release tooling. No change to the product.

### Changed
- The end-to-end tests start Chromium without `/dev/shm` shared memory, so a page no longer crashes in a container
  with a small `/dev/shm`; the password change test prepares its user itself and runs on its own.
- The release tools script shows the NSIS installation, retries it and checks `makensis` right away, so a failed
  install stops the job at once instead of the release tests minutes later.

### Compatibility
- No change to data, the API or the CLI.

## 0.5.6 — 2026-11-13

Keyboard focus stays on buttons, fields and checkboxes while their request runs.

### Fixed
- Buttons, fields and checkboxes keep keyboard focus while their request runs: they are marked unavailable to
  assistive technology (`aria-disabled`, `aria-busy`) instead of being disabled, and a second press meanwhile is
  ignored, so a form is not sent twice. Controls that are unavailable by meaning (an empty required field) stay
  disabled.

### Compatibility
- No change to data, the API or the CLI. Scripts and tests that look for the `disabled` attribute on a button while
  its request runs see `aria-disabled="true"` instead.

## 0.5.5 — 2026-11-13

Import keeps whole skill folders, a refused Agent Space budget grant is named as such, and the Source panel is
easier to read and to use from the keyboard.

### Fixed
- Import takes a whole skill folder: a zip, a folder upload or a git `path` that holds one skill folder used to give a
  skill with only its `SKILL.md`, the rest listed as unclaimed. A `SKILL.md` at the root of the source now takes every
  file no other package claims; commands, agents, hooks and other skill folders stay separate. Mirrors and tracked
  sources follow the same rule. Versions imported before stay as they are; import the folder again to get the full
  skill.
- A budget grant the Agent Space broker refuses (`401` or `403`) is reported as `budget_grant_rejected` instead of a
  provider error: the assistant answers `403` and says to get a new grant. A review-assistant run that got no result
  keeps the reason in its `error` (a code, such as `budget_grant_rejected` or `llm_timeout`) instead of `null`.
- The Source panel starts with a summary line (when the source was last checked and its state), shows the state as a
  badge with an icon (✓ new beta version, ⏳ quarantine, ⚠ problem), and keeps keyboard focus on its controls while a
  save or a check runs. A repeated message is announced again by screen readers.

### Compatibility
- No database migration. The help assistant answers a refused grant with `403 budget_grant_rejected` instead of
  `502`; the Agent Space broker reports the refusal on its socket from the Agent Space change
  `fix-skillforge-grant-refusal` on, and an older broker still gives `502 llm_upstream_error`.
- A review-assistant run that failed without any result now has a code in `error` instead of `null`.
- An import preview of one skill folder lists more files in the skill than before.

## 0.5.4 — 2026-11-13

Rules as an artifact type, model calls paid from Agent Space task budgets, and updates of skills that came from the
internet: a new upstream commit becomes a beta version for review.

### Added
- The `rule` artifact type: one `rules/<name>.md` with optional `paths`. It installs into Claude Code
  (`.claude/rules/`) and Cursor (`.cursor/rules/*.mdc`); a rule without `paths` is limited to 1500 tokens, since the
  agent loads it on every turn. An aging artifact whose latest version is confirmed again (`validate` or a `gate`
  evidence) returns to active.
- The Agent Space budget broker (`SKILLFORGE_BUDGET_SOCKET`): every model call goes through the broker's Unix socket,
  which holds the provider key and charges task budgets, with no fallback to the provider. A task budget grant can be
  given to the help assistant and to review-assistant checks; it is never stored, returned or logged.
- review-assistant runs paid from a task budget: idempotent by request id, resumable after a restart, bound to a
  coming publication, or queued as a list.
- Tracked sources: an artifact that came from git (an import, a starter pack, or a publish with provenance
  `import:<url>@<commit>:<path>`) keeps a link to its upstream folder, and existing artifacts get one from their
  provenance. With the mirrors (`SKILLFORGE_MIRROR_INTERVAL_HOURS`) or on **Check now**, the registry takes a new
  upstream commit through the source policy, the quarantine, the edit rules and the import checks, and publishes a
  changed folder as a new version in the `beta` channel; stable and the status stay. Edit rules (delete files by a
  glob, replace an exact string) keep local changes across updates; a rule that finds nothing stops the check as
  `edits_outdated`. GitHub sources work without `git` on the server, through `SKILLFORGE_GITHUB_API_URL` (with
  `SKILLFORGE_GITHUB_TOKEN` when set). The artifact page has a Source panel; the API is
  `GET`/`PUT /api/v1/artifacts/:type/:name/source` and `POST …/source/check`.

### Changed
- `skillforge harvest sessions` and harvest drafts write a rule by default (`rules/<name>.md`); `--type skill` and
  `type: "skill"` keep the skill draft.
- Skill checks by a model parse the answer strictly: one invalid finding (an invented quote, an extra key, a wrong
  category) rejects the whole answer as `invalid_output` instead of dropping that finding. The prompt version is now
  2, so earlier checks no longer count as up to date; run **Check published skills** to check them again.
- The CodeAlive starter pack has twelve skills:
  - `pragmatic-orchestration` follows its upstream release 5.0.1, and `coordinator-mode` from the same release is new;
  - `ux-best-practices` (UX audits and design against WCAG 2.2 AA) and `ubiquitous-language` (a project thesaurus for
    naming) are new.

  Installing the pack again adds the new skills and a new version of `pragmatic-orchestration`; versions already
  installed stay as they are. `pack.json` carries the local changes listed in `NOTICE.md` as edit rules, and the
  install puts them on each skill's tracked source.

### Fixed
- Git imports, mirrors and source checks take files exactly as they are in the repository. On Windows, Git's
  `core.autocrlf=true` (the Git for Windows default) used to turn line ends into CRLF in every imported text file.
  Versions imported that way stay as they are; a mirror on such a host publishes the same files with their original
  line ends once.

### Compatibility
- One database migration (`0051_artifact_sources`) and three migrations of the review-assistant plugin run on start;
  back up the data folder first, as for any upgrade. Existing artifacts with git provenance get a tracked source,
  turned on; the first background check runs one mirror interval after start (24 hours by default).
- Model checks of skills made before this release count as out of date (prompt version 2).
- No change to the CLI commands you already use, except the `harvest sessions` default above. A `skillforge publish`
  of one `.md` in a `rules/` folder publishes a rule.

## 0.5.3 — 2026-11-09

The Windows installer works again: the installers of 0.5.1 and 0.5.2 could stop while unpacking on Windows. The
archives, the CLI and the container image are unchanged.

### Fixed
- The installer unpacks its files with .NET instead of the system `tar.exe`, which converted file names through the
  console code page and failed on a dependency file with a non-ASCII name. Reinstalling the same version replaces its
  folder. Your data folder is not touched.
- The release script passes the payload folder to NSIS with the host's path separator, so the installer also builds
  with `makensis` on Windows.
- The README, the changelog and "Why SkillForge" named rules among the artifact types; the seven types are skills,
  commands, agents, hooks, plugins, settings profiles and MCP servers.

### Changed
- The release workflow installs the Windows installer on a Windows runner before it publishes anything.

### Compatibility
- No change to data, the API or the CLI. If the 0.5.1 or 0.5.2 installer stopped, run the 0.5.3 installer.

## 0.5.2 — 2026-11-09

CI on Windows is green again. No change to the product.

### Changed
- The release script and its tests share one way to run `tar`: on Windows the system `tar.exe` first and, when it
  fails (it crashed on the GitHub Windows runner), Git's GNU tar.

### Compatibility
- No change to data, the API or the CLI.

## 0.5.1 — 2026-11-09

The first release built by GitHub Actions: 0.5.0 was tagged, but its release workflow stopped before publishing
anything. Same product as 0.5.0, now also as a container image, with a tour and screenshots in the README.

### Added
- The container image `ghcr.io/marin-ai-tech/skillforge` (`:<version>` and `:latest`), published by the release
  workflow: the registry starts with one `docker run`. CI builds the image and checks that it answers the health check.
- A short animated tour and screenshots of the catalog, publishing, an artifact page, the Quality and Install tabs, the
  lifecycle board, metrics and the help center in the README.

### Changed
- CI and the release workflow install NSIS and the official Windows `node.exe` before the tests, since the release
  tests build the installer; test servers get 60 seconds to start on hosted runners.
- On Windows without the system `tar.exe`, the release script uses GNU tar with `--force-local`, and a failed `tar`
  now reports its error.

### Compatibility
- No change to data, the API or the CLI. Upgrade from 0.5.0 by installing over it.

## 0.5.0 — 2026-11-09

The first public release: a self-hosted registry for coding-agent artifacts, with review, lifecycle and installation
into eight agents.

### Added
- **Seven artifact types** with validation per type: skills, commands, agents, hooks, plugins, settings
  profiles and MCP servers.
- **Publishing** from the web interface and `skillforge publish`; **import** from zip archives, folders and git, with an
  import source policy and quarantine for fresh commits; upstream **mirrors** that re-import new releases as beta;
  installable **starter packs**.
- **Review and lifecycle**: candidate review with the self-promotion rule, statuses active, aging, zombie and retired,
  the lifecycle board with the "clean up today" list, holds and "replaced by" successors.
- **Checks**: a quality score with codes per type, hook risk analysis, duplicates and context cost, a content security
  scan with an install policy, company and team quality rules as a publish gate, evidence and evals on versions.
- **Versions and channels**: immutable, signed versions (Ed25519, checked by `skillforge install`), stable and beta
  channels, an acceptance gate, pins, downgrade protection, version diffs and rollback.
- **Teams**: organization and team visibility, ownership and co-authors, team availability (unavailable, installed by
  default, required) honoured by `sync`, `install` and `uninstall`; registry labels.
- **Agents**: install, sync and scan for Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Qwen Code, Devin and
  Reckon, a Claude Code plugin marketplace and settings profiles; agent snapshots and an organization inventory.
- **MCP**: the registry as an MCP server for agents (search, read and usage reporting), MCP servers as governed
  artifacts with an origin policy, and shadow MCP servers found by `skillforge agent scan --mcp`.
- **Metrics**: a metrics dashboard, session metrics from local agent logs, transfer rate and a report for management.
- **Orchestration** (off by default): workflows, routines and platform hooks with budgets and gates.
- **Server plugins** with a versioned API, badges on artifact cards and extension pages; the bundled `review-assistant`
  plugin runs independent reviews with external reviewers or a connected model.
- **Sign-in** with passwords, OIDC (including a Google preset) and LDAP/Active Directory; four roles; tokens with
  scopes, including MCP-only tokens.
- **Operations**: backups with retention and offline restore, health, `skillforge doctor` and a diagnostics bundle,
  rotated logs with masking, an audit log with NDJSON export.
- **In-app help** for every page and an optional help assistant that answers from the help with your own
  OpenAI-compatible model.
- **Releases**: zip and tar.gz archives, the CLI as one package, a Windows installer with Node.js, a Docker image.

### Compatibility
- Node.js 24 or later. Data lives in one SQLite database and a folder of blobs; migrations run on start.
- The interface ships in English. Other languages can be added locally (see CONTRIBUTING.md).

### Known limits
- Orchestration runs commands as the server's operating-system user without file-system isolation; turn it on only
  on a trusted installation.
- Review, scans and policies lower the risk of a harmful artifact; they do not sandbox the agents that use it.
- Cursor, Gemini CLI, Devin and Reckon do not accept every artifact type; see the agent pages for what each gets.
