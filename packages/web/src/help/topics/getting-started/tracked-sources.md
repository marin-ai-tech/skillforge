---
title: Tracked sources
summary: An artifact imported from git keeps a link to its upstream folder. The registry checks that folder and turns a new upstream commit into a beta version for review.
section: publishing
learn:
  - Which artifacts get a tracked source and what it stores
  - How a new upstream commit becomes a beta version
  - What each source state means and what to do about it
  - How edit rules keep local changes across updates
related: getting-started/provenance, getting-started/channels-and-pinning, getting-started/notifications-and-watch, pages/artifact, pages/import
---

A skill imported from the internet falls behind its upstream over time. A **tracked source** keeps the link to it: the repository address, the folder inside it, an optional branch or tag, the last commit taken, the time and result of the last check, and the edit rules. The **Source** panel on the artifact page shows all of this to everyone who can see the artifact.

## Which artifacts have a source

The registry creates a source when the latest version came from git: an import from a git repository, a starter pack install, or a publish with provenance `import:<url>@<commit>:<path>` where the commit is the full 40-character hash. Artifacts that were in the registry before get one from their provenance when the server starts. Hand-made artifacts have no source, and their page has no Source panel.

## How a check works

The server checks every enabled source together with the upstream mirrors, every `SKILLFORGE_MIRROR_INTERVAL_HOURS` hours, one source at a time. The owner, a maintainer or an admin can also click **Check now** in the panel. A check:

1. finds the commit of the branch or tag, or of the default branch when none is set;
2. stops as `unchanged` when this commit was already taken;
3. waits in quarantine while the commit is younger than the minimum release age of the import source policy;
4. downloads the folder through git, or as a GitHub archive when git is off or missing on the server;
5. applies the edit rules;
6. runs the import checks: the source policy, parsing, the security scan and the hook gate;
7. publishes a new version in the `beta` channel as `system` when the content of the folder changed.

The version number is the `version` from the frontmatter when it is above the latest version, otherwise the next patch version. Stable and the status do not change: people on `stable` get nothing until a reviewer moves the version. Watchers learn about the new version as usual; a failed check notifies the owner, the maintainers and the watchers.

## States

| State | Meaning | What to do |
|---|---|---|
| `ok` | a new version was published in `beta` | compare it with stable on the Versions tab and review it |
| `unchanged` | no new commit, or the commit did not touch the folder | nothing |
| `quarantined` | the commit is younger than the minimum release age | wait; the result of Check now says when it can be taken |
| `failed` | the check stopped; the panel names the reason | see the reasons below |
| `edits_outdated` | an edit rule found nothing in the new upstream version; the panel shows the rule | update or remove the rule |
| `path_missing` | the commit has no files in the folder | the folder moved upstream: import it again from the new place, or turn tracking off |

Common reasons of `failed`: `github_unreachable` (no network or the GitHub limit is reached), `ref_not_found` (the branch or tag is gone), `import_source_not_allowed` (the source policy does not allow the address), `transport_unavailable` (git is off or missing on the server and the source is not on GitHub), `archive_unsafe_path` (the archive points outside the folder) and `publish_blocked` (a hook or the security policy refused the version).

## Edit rules

Edit rules are the local changes the registry keeps over upstream content. A `delete` rule removes files that match a `glob`: `*` stays inside one folder level, `**` crosses folders. A `replace` rule replaces an exact `find` string in one `file` with `with`; an empty `with` removes the text. Rules apply to every download before the checks, so the digest and the security scan see the result. A rule that finds nothing stops the check as `edits_outdated` instead of publishing something else. Starter packs bring their rules from `pack.json`. The panel lists the rules; change them through the API:

```
PUT /api/v1/artifacts/skill/pdf/source
{"edits": [{"op": "delete", "glob": "assets/*.png"}]}
```

## Settings and API

The owner, a maintainer or an admin can turn tracking off (a disabled source is never checked) and pin a branch or tag; the address and the folder never change. The API has three routes: `GET …/source` for anyone signed in who can see the artifact, `PUT …/source` with `enabled`, `ref` and `edits`, and `POST …/source/check`, which answers `409 source_disabled` when tracking is off.

> [!NOTE]
> The archive transport calls `SKILLFORGE_GITHUB_API_URL`. Without `SKILLFORGE_GITHUB_TOKEN` GitHub allows about 60 requests an hour from one address; the token is sent only to that address.
