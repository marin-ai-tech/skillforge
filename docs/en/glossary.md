# Glossary

This page defines the terms used across SkillForge, in its interface, its CLI and these docs. Each entry gives a
short definition and links to the page that explains the term in full.

## A

- **Ablation.** A measurement of whether a skill helps: the same fixed task set is run with and without the skill,
  and the registry stores how many tasks passed each way. See [Skill evals](17-skill-evals.md).
- **Ablation Score (uplift).** `(passed_with - passed_without) / tasks` of the latest ablation, rounded to three
  decimals. An uplift at or below zero can mark an artifact zombie. See [Lifecycle by data](08-lifecycle-by-data.md).
- **Acceptance gate.** An eval suite setting (`gate: required`) that keeps new versions of a skill on `beta` until a
  holdout compare run shows no regression. See [Skill evals](17-skill-evals.md).
- **Active.** The lifecycle status of an artifact a reviewer endorsed for normal use. Only active artifacts get
  install commands and are visible over MCP and in the marketplace. See
  [Lifecycle and review](07-lifecycle-and-review.md).
- **Agent (artifact type).** One markdown file with `name` and `description` frontmatter that defines a subagent
  persona, stored under `agents/<name>.md`. See [Artifact types](05-artifact-types.md).
- **Agent (snapshot).** A named snapshot of a local or server agent folder, compared item by item with the registry.
  See [Agents and inventory](12-agents-and-inventory.md).
- **Agent runtime.** One of the eight coding agents SkillForge installs into, named by its `--runtime` id such as
  `claude-code` or `codex`. See [Agent runtimes](agents/README.md).
- **Agents list.** The author's optional list of agents an artifact is for, with minimum versions, such as
  `claude-code>=2.1,codex`. It is advice: installing elsewhere only prints a warning. See
  [Agent runtimes](agents/README.md#which-agents-an-artifact-is-for).
- **Aging.** The status of an active artifact whose latest version was not validated or published for longer than
  the aging threshold (90 days by default). See [Lifecycle and review](07-lifecycle-and-review.md).
- **API token.** A personal Bearer secret `sf_…` for the CLI and automation that acts with its owner's role. It is
  shown only once. See [Handbook by role](handbook/README.md#sessions-tokens-and-roles).
- **Artifact.** A named, versioned package in the registry, identified by type and name: skill `deploy` and command
  `deploy` are different artifacts. See [Artifact types](05-artifact-types.md).
- **Audit log.** The record of who did what and when: publishes, transitions, ownership, policy and user changes.
  See [Admin](handbook/admin.md#see-what-people-use).
- **Availability.** A per-team setting on an artifact: not available, available, installed by default or required.
  `skillforge sync` follows it. See [Teams, visibility and ownership](11-teams-visibility-ownership.md).

## B

- **Badge.** A short label that an enabled server plugin sets on an artifact card, such as the outcome of a review.
  See [Plugins](14-plugins.md).
- **Beta.** The release channel for experimental versions. Plain installs ignore it; people opt in with `@beta`. See
  [Versions and channels](10-versions-and-channels.md).
- **Blob.** A stored file, addressed by the SHA-256 of its bytes and never overwritten. See
  [Versions and channels](10-versions-and-channels.md).

## C

- **Candidate.** The status of a newly published version that waits for a reviewer. See
  [Lifecycle and review](07-lifecycle-and-review.md).
- **Canonical layout.** The paths a type is stored under, such as `skills/<name>/SKILL.md` or
  `commands/<name>.md`. See [Artifact types](05-artifact-types.md).
- **Channel.** `stable` or `beta`; every version belongs to one. `latest` is the highest stable version. See
  [Versions and channels](10-versions-and-channels.md).
- **Command.** One markdown file with a slash-style prompt, stored under `commands/<name>.md`. See
  [Artifact types](05-artifact-types.md).
- **Company quality rules.** An admin's threshold, mode, weights and own criteria that score every version; in
  block mode a version below the threshold is refused. See [Quality and security](09-quality-and-security.md).
- **Context cost.** An estimate of the tokens an artifact puts into the agent's context: every turn, when used, and
  other files on demand. See [Quality and security](09-quality-and-security.md).

## D

- **Delete-today board.** The Lifecycle tab that lists aging and zombie artifacts to revalidate or retire. See
  [Lifecycle and review](07-lifecycle-and-review.md).
- **Digest.** The SHA-256 of a version's canonical file list; identical bytes give the same digest on every machine.
  See [Versions and channels](10-versions-and-channels.md).
- **Duplicates.** Advisory reports of the same content in several places: name collisions, identical bodies, shared
  files, similar descriptions, and copies under several roots of an agent folder. See
  [Quality and security](09-quality-and-security.md).

## E

- **Edit rule.** A local change a tracked source keeps over upstream content: delete files by a glob, or replace an
  exact string in a file. Applied to every new upstream version before the checks. See
  [Publishing and import](06-publishing-and-import.md#tracked-sources).
- **Eval suite.** A skill's list of trigger, task and holdout cases plus an optional acceptance gate. See
  [Skill evals](17-skill-evals.md).
- **Evidence.** Links or documents attached to a version that prove something about it, of kind `gate`, `run`,
  `diff`, `review`, `eval` or `ablation`. See [Contributor](handbook/contributor.md#add-evidence-and-evals).

## G

- **Grade.** The letter A–D derived from the advisory quality score of a version. It never blocks publishing. See
  [Quality and security](09-quality-and-security.md).

## H

- **Harvest.** Collecting rules that recur in review comments or in your own agent sessions into a draft skill. See
  [Admin](handbook/admin.md#bring-artifacts-to-repositories-and-agents).
- **Hold.** A reviewer's freeze of automatic aging and zombie transitions for one artifact until a date. See
  [Reviewer](handbook/reviewer.md#hold-an-artifact).
- **Hook.** A Claude Code hook bundle with `hooks.json`; it runs on its own and installs only through the Claude Code
  plugin marketplace. See [Artifact types](05-artifact-types.md).

## I

- **Import.** Publishing many packages at once from a zip archive, a folder or a git repository. See
  [Publishing and import](06-publishing-and-import.md).
- **Inventory.** The admin view that sums up everyone's agent snapshots: installed artifacts, drifted copies,
  unpublished items and MCP servers. See [Agents and inventory](12-agents-and-inventory.md).

## L

- **Label.** A kebab-case registry label on an artifact, editable without a new version, used for filters and MCP
  tag consent. See [Contributor](handbook/contributor.md#maintain-your-artifact).
- **Latest.** The highest version in the `stable` channel, or the highest beta when there is no stable version. See
  [Versions and channels](10-versions-and-channels.md).
- **Layer of edits.** Operations (`append`, `replace`, `add`) that a company, a team or a person keeps over an
  artifact's files; `install` and `sync` apply them. See
  [Admin](handbook/admin.md#bring-artifacts-to-repositories-and-agents).
- **Lifecycle status.** One of candidate, active, aging, zombie and retired. Only reviewers and admins change it. See
  [Lifecycle and review](07-lifecycle-and-review.md).
- **Lock file.** `.skillforge-lock.json` in an agent folder: the installed versions, digests, file hashes, pins and
  runtime. See [Agent runtimes](agents/README.md#install-and-sync-with-the-cli).

## M

- **Maintainer.** A co-author who may publish new versions of an artifact next to its owner. See
  [Teams, visibility and ownership](11-teams-visibility-ownership.md).
- **Marketplace.** The Claude Code plugin marketplace that SkillForge serves at `marketplace.json`. See
  [Claude Code](agents/claude-code.md#install-through-the-plugin-marketplace).
- **MCP.** The Model Context Protocol. SkillForge is an MCP server that lets agents search and read active artifacts.
  See [MCP](13-mcp.md).
- **MCP policy.** The admin's list of package types and remote origins an `mcp-server` artifact may use. See
  [MCP](13-mcp.md).
- **MCP server (artifact type).** The description of an approved MCP server: `MCP.md` and `server.json`. It is not
  installed into agents yet. See [Artifact types](05-artifact-types.md).
- **MCP tags.** Up to ten tags on an MCP token that limit the agent to active artifacts sharing a tag or label. See
  [MCP](13-mcp.md).
- **MCP token.** An API token created with the MCP option; it works only for agents and is refused by the REST API.
  See [MCP](13-mcp.md).
- **Method pack.** A versioned set of roles, each listing artifacts at exact versions, installed with
  `skillforge pack install`. See [Viewer](handbook/viewer.md#install-a-method-pack).
- **Mirror.** A git source the registry checks daily; new packages arrive as candidates, changes as beta versions.
  See [Publishing and import](06-publishing-and-import.md).
- **Model compatibility.** Tags a reviewer merges into a version when validating it against target models. See
  [Reviewer](handbook/reviewer.md#validate-a-version).

## O

- **Orphan.** An artifact whose owner was disabled or no longer exists; admins hand it over on the Users page. See
  [Teams, visibility and ownership](11-teams-visibility-ownership.md).
- **Overhang.** A report of artifacts whose ablation evidence shows no uplift, so the model may no longer need them.
  It never retires anything. See [Lifecycle by data](08-lifecycle-by-data.md).
- **Owner.** The one user an artifact belongs to; the first publisher, unless ownership was transferred. See
  [Teams, visibility and ownership](11-teams-visibility-ownership.md).

## P

- **Pin.** A version spec other than `latest` saved in the lock file; `sync` resolves the pin instead of `latest`.
  See [Versions and channels](10-versions-and-channels.md).
- **Plugin (artifact type).** A self-contained Claude Code plugin bundle with `.claude-plugin/plugin.json`. See
  [Artifact types](05-artifact-types.md).
- **Provenance.** Where a version came from: a `source` (`human`, `reckon`, `agentspace`, `dreamteam`, `import`, or
  the agent or harvest it was published from) and a `ref`. See [Publishing and import](06-publishing-and-import.md).
- **Publish override.** A reviewer or admin publishing into an artifact they do not own; accepted and audited as
  `publish_override`. See [Teams, visibility and ownership](11-teams-visibility-ownership.md).
- **Purge.** An irreversible admin removal of leaked content that leaves a tombstone. See
  [Metadata and purge](19-metadata-and-purge.md).

## Q

- **Quarantine.** The hold on importing a git commit younger than the minimum release age of the import source
  policy. See [Publishing and import](06-publishing-and-import.md).

## R

- **Registry.** The self-hosted SkillForge server that stores, reviews and distributes artifacts for an organisation.
  See [Why SkillForge](01-why-skillforge.md).
- **Replaced.** A mark on an artifact that points to a successor of the same type; `sync` installs the successor.
  See [Versions and channels](10-versions-and-channels.md).
- **Retired.** The status of an artifact that is no longer recommended; it can be restored to candidate. See
  [Lifecycle and review](07-lifecycle-and-review.md).
- **Review assistant.** A server plugin that has several models review a version and a reviewer decide each
  finding. See [Quality and security](09-quality-and-security.md).
- **Role.** viewer, contributor, reviewer or admin, in that order; a higher role can do everything a lower one can.
  See [Handbook by role](handbook/README.md).
- **Rollout.** Pull requests the registry opens to add active artifacts and the lock file to repositories. See
  [Admin](handbook/admin.md#bring-artifacts-to-repositories-and-agents).
- **Routine.** A workflow or command run on a cron schedule on the server. See [Orchestration](18-orchestration.md).

## S

- **Scope (install).** `project` (relative to the current directory) or `user` (relative to your home) for
  `install`, `sync` and `uninstall`. See [Agent runtimes](agents/README.md#install-and-sync-with-the-cli).
- **Security scan.** A built-in check of every version for risky patterns, with the verdict pass, warn or fail. See
  [Quality and security](09-quality-and-security.md).
- **Self-promotion.** Promoting a version you published yourself. It is refused for reviewers; an admin needs a
  reason. See [Lifecycle and review](07-lifecycle-and-review.md).
- **Session facts.** The few fields per skill call that `skillforge sessions import` uploads from local agent
  sessions; no prompts or paths. See [Session metrics](16-session-metrics.md).
- **Settings profile.** A fragment of Claude Code settings applied with `skillforge settings apply`. See
  [Artifact types](05-artifact-types.md).
- **Shadow MCP server.** An MCP server found in people's agent configs that no registry `mcp-server` declares. See
  [MCP](13-mcp.md).
- **Signature.** The registry's signature over the exact files of every version; `install` and `sync` check it
  before writing. See [Quality and security](09-quality-and-security.md).
- **Skill.** A folder centred on `SKILL.md` with optional scripts, references and assets. See
  [Artifact types](05-artifact-types.md).
- **Snapshot status.** How an item of an agent snapshot compares with the registry: `local_only`, `in_sync`,
  `outdated`, `modified` or `registry_only`. See [Agents and inventory](12-agents-and-inventory.md).
- **Stable.** The default release channel; `latest` and plain installs follow it. See
  [Versions and channels](10-versions-and-channels.md).
- **Starter pack.** A vendored set of MIT-licensed skills an admin installs into an empty registry. See
  [Publishing and import](06-publishing-and-import.md).
- **Sweep.** The run that applies the lifecycle policy, hourly and on demand; a dry run previews it. See
  [Lifecycle by data](08-lifecycle-by-data.md).

## T

- **Team.** A group of people who share private artifacts, with members and leads. See
  [Teams, visibility and ownership](11-teams-visibility-ownership.md).
- **Tracked source.** The upstream git folder an artifact came from; the registry checks it and publishes a changed
  folder as a beta version. See [Publishing and import](06-publishing-and-import.md#tracked-sources).
- **Transfer Rate.** helped / uses over usage reports, shown as a percentage. See
  [Metrics dashboard](15-metrics-dashboard.md).
- **Translated install.** An install the CLI converted to an agent's format; a scan compares it through the lock file.
  See [Agent runtimes](agents/README.md#scan-an-agent-folder).

## V

- **Validation.** A reviewer's mark on a version that sets `validated_at` and merges model compatibility tags. See
  [Reviewer](handbook/reviewer.md#validate-a-version).
- **Version.** An immutable semver snapshot of an artifact with its own digest; it is never overwritten. See
  [Versions and channels](10-versions-and-channels.md).
- **Visibility.** `org` (everyone who can read the registry) or `team` (the owner team and moderators). See
  [Teams, visibility and ownership](11-teams-visibility-ownership.md).

## W

- **Watch.** Following an artifact to get its comments, new versions and status changes as notifications. See
  [Viewer](handbook/viewer.md#discuss-and-follow-artifacts).
- **Workflow.** Ordered steps attached to a skill and run on the server. See [Orchestration](18-orchestration.md).

## Z

- **Zombie.** The status of an artifact marked unused or stale, by a reviewer or by data rules. See
  [Lifecycle and review](07-lifecycle-and-review.md).
