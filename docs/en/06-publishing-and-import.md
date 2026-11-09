# Publishing and import

This page shows every way to get artifacts into the registry: the Publish page, `skillforge publish` from a
shell or CI, the Import page for zip archives, folders and git repositories, upstream mirrors that an
administrator keeps in step, and the starter packs that seed an empty registry. All routes run the same
validation, the same security scan and the same publish hook gate. In-app help: `getting-started/upload-artifacts`.

## Pick a route

Uploading needs the `contributor` role or higher.

| Where the files are | Route | Where |
|---|---|---|
| One package, or a CI job | Publish | `/publish` or `skillforge publish` |
| A git repository (GitHub or another host) | Import, source `git` | `/import` |
| A zip archive | Import, source `zip` | `/import` |
| A folder on your computer with many packages | Import, source `folder` | `/import` |
| Your agent's folder, to publish only what is new | Agent snapshot | `skillforge agent scan`, then `skillforge agent publish` ([Agents and inventory](12-agents-and-inventory.md)) |
| A git source that should be checked again and again | Upstream mirror (admin) | `/import`, section Upstream mirrors |
| An empty registry | Starter packs (admin) | `/start` |

## The Publish page

Publish (`/publish`) creates one new immutable version. Choose a mode: **files** to upload a folder or files, or
**paste** to type a single-file command, agent or skill. Then fill in:

- type, name and description (the name must agree with the frontmatter and folder rules);
- version — leave it empty to get `0.1.0` for a new artifact or the next patch number after the latest version;
  an explicit version is a semver without a `v` prefix;
- changelog and model compatibility;
- provenance source and reference (see below);
- visibility: `org` for everyone, or `team` with an owner team ([Teams, visibility and ownership](11-teams-visibility-ownership.md)).

The issue list updates as you go and links every `E_*` and `W_*` code to its help topic. After the dry-run
validation two advisory blocks appear, **Quality** and **Possible duplicates**; they never disable the Submit
button. Clear every Blocking issue, then submit.

## Publishing from the CLI

Sign in once with a token created on `/me/tokens` without the MCP option, then validate and publish a folder or
a single Markdown file:

```bash
skillforge login --url https://skillforge.example.com --token <sf_token>
skillforge validate .claude/skills/release-notes --type skill
skillforge publish .claude/skills/release-notes --type skill --version 0.2.0 --changelog "Covers hotfix releases"
```

Useful options of `skillforge publish`:

| Option | Meaning |
|---|---|
| `--type <type>` | artifact type |
| `--name`, `--description` | override the values found in the package |
| `--version <semver>` | leave out for an automatic version |
| `--changelog <text>` | what changed |
| `--provenance <source[:ref]>` | where the package came from, for example `agentspace:job-42` |
| `--visibility org\|team`, `--team <name>` | scope of a first publish |
| `--agents <list>` | agents the artifact is for, for example `claude-code>=2.1,codex` |
| `--json` | machine-readable output |

The CLI prints Blocking and Warning codes, then `type/name@version` and the card URL. Exit codes let CI gate on
the result: `0` success, `1` validation or bad input, `2` conflict (`version_exists`, `digest_exists`), `3` no
registry configured or reachable, `4` unauthorized.

A token with the MCP option works only on the MCP endpoint, so the CLI gets `mcp_token_forbidden` with it. MCP
itself cannot upload; see [MCP](13-mcp.md).

## Provenance

Every version records `provenance: { source, ref }`: where the package came from. Reviewers use it to decide what
to evaluate first. The Publish form and the Import page offer these sources:

| Source | Meaning |
|---|---|
| `human` | written and uploaded by a person (the default) |
| `reckon` | a skill learned by a Reckon agent; put the run id in `ref` |
| `agentspace`, `dreamteam` | team pipelines; use `ref` for a job or repository |
| `import` | a bulk intake, such as a git repository or an upstream mirror |

The registry also writes two sources itself: `agent` for a version published from an agent snapshot (with the
agent name as `ref`) and `harvest` for a draft made from rules collected in past reviews. An unknown source is
rejected with `provenance_invalid`. Provenance does not affect digests: the same bytes with a different source
still collide on `digest_exists`.

## Import: zip, folder or git

Import (`/import`, user menu) scans a source for skill, command, agent and hook packages, runs the Publish
dry-run on each one and publishes the rows you select in one pass. Use it for an agent folder (`.claude`,
`.codex`, `.cursor`, `.opencode`, `.qwen`, `.gemini`, `.reckon/skills`), a Claude plugin layout or a git tree.

1. Choose the source:
   - `zip` — an archive; if every entry sits in one top-level folder, that folder is stripped;
   - `folder` — a directory picked in the browser; `node_modules` and `.git` are dropped before upload;
   - `git` — a repository address: `https://`, `ssh://` or `git@host:path`. Optionally a branch or tag
     (a commit hash does not work) and a folder inside the repository such as `.claude/skills`.
2. Click **Preview**. Each candidate shows its type, name, file count and a status: Ready, Warnings, Errors or
   Conflict. Skipped paths are listed too.
3. Keep the rows you want. Optionally choose a provenance source for all of them; by default each candidate keeps
   the detected one (`reckon` for `.reckon/skills`, `human` for the rest).
4. Leave **Skip conflicts** on to report an existing digest or version as skipped rather than failed, then click
   **Import selected**. The results link to the created artifacts; each publish is audited with a `meta.import`
   record.

Limits and rules:

- An import holds at most 5000 files and 64 MB (`import_too_large`); set a folder inside the repository or split it.
- The server clones git itself, with its own git setup and network access: a shallow clone of the latest commit,
  with a two-minute limit. A private repository needs the server's own access.
- `file://` addresses and local paths work only when the operator sets `SKILLFORGE_IMPORT_ALLOW_FILE_URLS`;
  other forms get `import_url_not_allowed`. `SKILLFORGE_IMPORT_GIT` (on by default) turns git import off
  (`import_git_disabled`).
- A preview lives for a short time (`SKILLFORGE_IMPORT_TTL_MINUTES`, 15 minutes by default).
- Skip conflicts does not override ownership: a package owned by someone else fails with `not_owner`.

There is no CLI command for Import. `skillforge sessions import` is something else: it uploads usage facts.

## Import source policy and quarantine

An administrator sets the import source policy on the Import page:

| Setting | Effect |
|---|---|
| git mode `open` or `allowlist` | in allowlist mode only listed addresses are accepted (`import_source_not_allowed`) |
| allowed sources | rules `host[:port][/org[/repo]]`, or `local` for file addresses; compared by host and path segments, not as text |
| allow archives | when off, only admins may upload zip and folder sources (`import_archives_disabled`) |
| minimum release age | 0–365 days a commit must wait before it can be imported |

The release age counts from when the registry first saw the commit at that address, not from the date in the
commit, because the author sets that date. A commit that is too new is shown as in quarantine and the run gives
`import_too_fresh`; an admin can import it anyway with a reason that goes to the audit log.

## Upstream mirrors

A mirror is a git source the registry checks regularly: every `SKILLFORGE_MIRROR_INTERVAL_HOURS` (24 by
default, `0` turns background checks off) or when an admin clicks **Check now**. A mirror has an address, an
optional ref and folder, and an optional list of `type/name` ids to take.

- A new package arrives as a new artifact in status `candidate`.
- A changed package arrives as a new version in the `beta` channel, so people on `stable` get nothing until
  someone moves it ([Versions and channels](10-versions-and-channels.md)).
- Every check goes through the source policy, the quarantine, the security scan and the hook gate; a check of a
  commit in quarantine reports when it can go.
- Mirrored versions have provenance `import` with the address, commit and folder as `ref`.
- Deleting a mirror keeps the artifacts it created.

## Starter packs

A fresh registry is empty. SkillForge ships vendored starter packs that install without network access:

| Pack id | Contents |
|---|---|
| `codealive` | nine MIT-licensed skills, copied byte for byte from their upstream repositories |
| `ecc-essentials` | three MIT-licensed skills (`change-impact`, `architecture-decision-records`, `codebase-onboarding`), edited for SkillForge; every change is listed in `NOTICE.md` |

Only an admin installs packs: from the first-run page `/start`, or with
`POST /api/v1/admin/starter-packs/<id>/install`. Every skill arrives as `candidate` with provenance `import` and a
reference to the upstream repository and commit. A second install is idempotent. Keep each pack's `LICENSE` and
`NOTICE.md` when you redistribute it. The pack folder can be overridden with `SKILLFORGE_STARTER_PACKS_DIR`.

## After the upload

- The first publish of a name creates the artifact in status `candidate` and makes you its owner. After that, only
  the owner, co-authors, reviewers and admins can add versions ([Teams, visibility and ownership](11-teams-visibility-ownership.md)).
- Agents do not see a candidate through MCP or the marketplace: only `active` artifacts are offered there. A
  reviewer promotes it on the Lifecycle board ([Lifecycle and review](07-lifecycle-and-review.md)).
- Status belongs to the artifact, not to a version. A new version of an artifact that is already `active` keeps
  that status, so ship risky changes to the `beta` channel first.

## Common errors

| Error | What to do |
|---|---|
| `digest_exists` | the same content is already published; change the content or do nothing |
| `version_exists` | the version number is taken; raise it or leave it out |
| `not_owner` | the artifact belongs to someone else; ask the owner to add you as a co-author |
| `publish_blocked` | a subscribed hook stopped the publish; read the reason. `hook unavailable:` means an admin must repair or disable the subscription ([Orchestration](18-orchestration.md)) |
| `E_SECURITY_BLOCKED` | the security policy refuses a risky pattern ([Quality and security](09-quality-and-security.md)) |
| `E_RUBRIC_BLOCKED` | the company or team quality rules refuse the score |
| `mcp_token_forbidden` | the token has the MCP option; create one without it |
| `import_url_not_allowed` | use `https://`, `ssh://` or `git@host:path` |
| `import_too_large` | over 5000 files or 64 MB; narrow the folder |

## See also

- [Artifact types](05-artifact-types.md) — required files and validation codes for each type.
- [Lifecycle and review](07-lifecycle-and-review.md) — what happens to a candidate.
- [Worked examples](21-cookbook.md) — end-to-end recipes.
