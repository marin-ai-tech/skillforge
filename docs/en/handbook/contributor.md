# Contributor

A contributor is an author: they publish new versions, import packages in bulk and look after the artifacts they
own. This chapter lists what a contributor can do on top of a viewer and walks through publishing, importing,
shipping a beta and maintaining an artifact. A new version always lands as `candidate`; a reviewer decides when it
becomes `active`.

## On this page

- [What a contributor can do](#what-a-contributor-can-do)
- [Publish one package](#publish-one-package)
- [Import many packages](#import-many-packages)
- [Publish from your agent folder](#publish-from-your-agent-folder)
- [After publishing](#after-publishing)
- [Ship a beta version](#ship-a-beta-version)
- [Maintain your artifact](#maintain-your-artifact)
- [Add evidence and evals](#add-evidence-and-evals)
- [Common errors](#common-errors)
- [See also](#see-also)

## What a contributor can do

Everything a [viewer](viewer.md) can do, plus:

| Task | Where |
|---|---|
| Publish a new artifact or version | Publish (`/publish`), `skillforge publish` |
| Import from a zip, a folder or a git repository | Import (`/import`) |
| Publish a local item from an agent snapshot | the agent page, `skillforge agent publish` |
| Publish a method pack | `POST /api/v1/packs` |

These rights apply to artifacts you own or maintain: the first publish of a name makes you its owner, and after that
only the owner, maintainers, reviewers and admins can add versions. A contributor cannot change lifecycle status.

## Publish one package

1. Prepare the package in its canonical layout: a skill is a folder with `SKILL.md` (frontmatter `name` and
   `description`, a non-empty body); a command or an agent is one markdown file. See
   [Artifact types](../05-artifact-types.md).
2. Validate it. Blocking codes `E_*` stop the publish; warnings `W_*` do not:

   ```bash
   skillforge validate ./skills/pdf-tools --type skill --json
   ```

3. Publish it:

   ```bash
   skillforge publish ./skills/pdf-tools --type skill --version 0.1.0 --changelog "First version"
   ```

   Leave out `--version` to get `0.1.0` for the first version and patch + 1 after that. Add
   `--agents "claude-code>=2.1,codex"` to list the agents it is for, `--provenance reckon:run-7` when it came from
   another source, and `--visibility team --team payments` to keep a new artifact inside a team.

4. Or use the **Publish** page: pick the type, upload or paste the files, fill name, description, version,
   changelog and provenance, read the issue list, and choose **Submit**.

Limits: 32 MiB per bundle, 16 MiB per file, at most 1000 files; names are 1–64 characters of `a-z0-9-`; descriptions
are at most 1024 characters. After validation the page also shows the advisory quality grade and possible duplicates.
Neither disables Submit. The registry scans the content for risky patterns and signs every version.

## Import many packages

1. Open **Import** from the user menu and choose the source: `zip`, `folder` or `git` (`https://`, `ssh://` or
   `git@host:path`, with an optional branch or tag and folder).
2. Choose **Preview**. Each candidate shows Ready, Warnings, Errors or Conflict.
3. Select the rows you want. **Skip conflicts** is on by default, so a repeated import creates no duplicates.
4. Optionally override provenance, then choose **Import selected** and open the created artifacts from the results.

Import recognizes agent folders (`.claude`, `.codex`, `.cursor`, `.opencode`, `.qwen`, `.reckon/skills`), Claude
plugin layouts and plain git trees. There is no CLI command for import. See
[Publishing and import](../06-publishing-and-import.md).

## Publish from your agent folder

```bash
skillforge agent scan .claude --name laptop
skillforge agent publish skill/my-notes --name laptop --version 0.1.0 --changelog "From my laptop"
```

Items marked `local_only` exist only on your machine; `modified` means your copy differs from every published
version. The **Publish** button on the agent page does the same. The version records provenance `agent:<name>`.

## After publishing

1. Check the new version on the artifact page: Overview, Files, Quality (grade, security scan, context cost).
2. Ask a reviewer to promote it. You cannot promote your own latest version, whatever your role; only an admin may,
   with a reason that the audit log marks.
3. Until it is `active`, agents do not see it through MCP or the marketplace, and the Install tab shows no command.

## Ship a beta version

- A version with a pre-release suffix such as `0.3.0-beta.1` goes to the `beta` channel and can never be stable.
  Plain installs keep following `latest`, the highest stable version.
- On the **Versions** tab, **Promote to stable** or **Move to beta** moves a version between channels. Moving a
  stable version back to beta takes it out of `latest` without deleting anything.
- If the skill's eval suite has the acceptance gate on, new versions land on beta, and promotion to stable needs a
  holdout compare run that does not regress. See [Skill evals](../17-skill-evals.md).
- Testers install the beta on purpose: `skillforge install skill/pdf-tools@beta`.

## Maintain your artifact

| Task | How |
|---|---|
| Fix the caption without a new version | metadata panel, or `skillforge metadata set skill/pdf-tools --description "…"`; `--reset description` undoes it |
| Change the agents list | the Agents field in the metadata panel |
| Group artifacts | `skillforge labels skill/pdf-tools set payments,pdf` |
| Point to a successor | **Save successor** on the old artifact's page; `sync` then installs the successor |
| Add a co-author or hand over | the ownership panel (owner and admin only) |
| Move into a team or back to the whole organisation | the scope panel, or `skillforge scope skill/pdf-tools --visibility team --team payments`; an owner must be a member of the current and the target team |
| Answer questions | the Comments tab; mentions notify the person |

The metadata panel, labels and channels follow the same rule as publishing: owner, maintainers, reviewers and admins.
See [Teams, visibility and ownership](../11-teams-visibility-ownership.md) and
[Metadata and purge](../19-metadata-and-purge.md).

## Add evidence and evals

Evidence links a version to results reviewers can open:

```bash
skillforge evidence add skill/pdf-tools@1.2.0 --kind gate --url https://ci.example/runs/42 --summary "evals 18/20"
skillforge evidence add skill/pdf-tools@1.2.0 --kind review --file ./review.md
skillforge evidence add skill/pdf-tools@1.2.0 --kind ablation --url https://ci.example/1 --tasks 20 --passed-with 16 --passed-without 10
```

A `gate` record sets the version's `validated_at`. For a skill, push an eval suite of trigger, task and holdout
cases with `skillforge evals push skill/pdf-tools --file suite.json`, and run it from the **Evals** tab or
`skillforge evals run`. See [Quality and security](../09-quality-and-security.md).

## Common errors

| Error | What to do |
|---|---|
| `digest_exists` | the same content is already published; change the content or do nothing |
| `version_exists` | the version number is taken; raise it or leave it out |
| `not_owner` | someone else owns the artifact; ask them to add you as a maintainer |
| `agents_invalid` | an unknown agent, a malformed version, a repeated agent, or an agent the type does not install into |
| `mcp_token_forbidden` | your token has the MCP option; create a token without it |
| `publish_blocked` | a subscribed hook stopped the publish; read the reason in the response |
| `E_SECURITY_BLOCKED` | the admin made a failed security scan block publishing; fix the finding |

## See also

- [Handbook by role](README.md) for the other roles.
- [Reviewer](reviewer.md) for what happens to your candidate.
- [Versions and channels](../10-versions-and-channels.md) for semver, digests and pins.
- In-app help: `pages/publish`, `pages/import`, `getting-started/upload-artifacts`, `getting-started/ownership`.
