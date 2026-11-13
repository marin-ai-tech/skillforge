# Changelog

All notable changes to SkillForge. Versions follow [Semantic Versioning](https://semver.org/); while the major version
is 0, a minor version may change behavior.

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
