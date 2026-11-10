# Changelog

All notable changes to SkillForge. Versions follow [Semantic Versioning](https://semver.org/); while the major version
is 0, a minor version may change behavior.

## 0.5.3 — 2026-11-09

The Windows installer also builds on Windows, and the README names the artifact types correctly. No change to the
product.

### Fixed
- The release script passes the payload folder to NSIS with the host's path separator, so `makensis` on Windows finds
  `payload.zip` and the other installer files (it failed with "no files found" on the GitHub Windows runner).
- The README, the changelog and "Why SkillForge" named rules among the artifact types; the seven types are skills,
  commands, agents, hooks, plugins, settings profiles and MCP servers.

### Compatibility
- No change to data, the API or the CLI.

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
