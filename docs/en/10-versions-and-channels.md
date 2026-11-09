# Versions and channels

Every publish adds an immutable version to an artifact. This page explains how versions are numbered, how
content digests prove that nothing changed, how the `stable` and `beta` channels decide what people receive, how
consumers pin a version, how to compare two versions and roll back, and how to point an outdated artifact at its
successor. In-app help: `getting-started/versions-and-digests` and `getting-started/channels-and-pinning`.

## Versions are immutable

An artifact is identified by `type` and `name`. Each publish adds a semver `version` and a content `digest`, and
neither ever changes afterwards:

- publishing the same bytes again is refused with `digest_exists`;
- reusing a version number is refused with `version_exists`;
- a conflict never touches the versions already stored.

A version also records its changelog, provenance, model compatibility, evidence links, who published it and
when. Metadata such as the description or tags can be edited later without a new version, and an admin can purge
a version irreversibly; both are covered in [Metadata and purge](19-metadata-and-purge.md).

## Version numbers

Leave the version out and SkillForge picks one: `0.1.0` for the first publish, then the next patch number after
the latest version (`0.1.0` → `0.1.1`). An explicit version must be an unused semver without a `v` prefix, such as
`1.2.0` or `2.0.0-beta.1`.

```bash
skillforge publish .claude/skills/release-notes --type skill              # next patch
skillforge publish .claude/skills/release-notes --type skill --version 1.0.0
```

## Digests

| Digest | How it is computed |
|---|---|
| File digest | SHA-256 of the file bytes, 64 lowercase hex characters |
| Version (bundle) digest | SHA-256 of the lines `path\0fileDigest\n`, sorted by path |

Digests are the same on every machine and do not depend on file order. Files are stored content-addressed under
`blobs/<two hex characters>/<sha256>` and never overwritten. The Versions tab lists each version's digest, publish
time and publisher; the audit log records the digest of every publish. The registry also signs each version's
file list, and the CLI checks it before installing ([Quality and security](09-quality-and-security.md#signed-versions)).

To share an exact snapshot, add `?version=1.2.3` to the artifact page link. The version selector on the page
switches Overview and Files to another version.

## Channels: stable and beta

Every version belongs to one release channel.

| Version | Channel |
|---|---|
| with a pre-release suffix, such as `0.3.0-beta.1` | always `beta`; it can never move to `stable` |
| any other version | `stable` by default; send `"channel": "beta"` in the publish request to ship it as beta |

`latest` is the highest `stable` version. A lower historical number never replaces it, and a beta version does
not become latest unless the artifact has no stable version at all; then the card shows a `beta` chip. The
artifact header shows the latest stable version and, when a newer beta exists, that beta too.

The Claude Code marketplace, MCP and plain installs follow `latest`, so a beta version reaches only people who
ask for it. Upstream mirrors deliver changed packages to `beta` ([Publishing and import](06-publishing-and-import.md#upstream-mirrors)).

Lifecycle status belongs to the artifact, not to a version: a new version of an `active` artifact is not
reviewed again as a candidate. The beta channel is how you let volunteers try a change first.

### Moving a version between channels

On the Versions tab, **Promote to stable** moves a checked beta version to `stable`, and **Move to beta** takes a
stable version out of `latest` without deleting it. The bytes and digest do not change; `latest` is recomputed at
once and the change is audited as `channel_change`. The owner or a maintainer may do it, as for publishing; a
reviewer or admin may do it as an audited override. MCP tokens cannot.

```bash
curl -X POST "$SKILLFORGE_URL/api/v1/artifacts/skill/release-notes/versions/1.3.0/channel" \
  -H "Authorization: Bearer $SKILLFORGE_TOKEN" -H "Content-Type: application/json" \
  -d '{"channel":"stable"}'
```

### The acceptance gate

A skill whose eval suite has `gate: required` is protected further: a publish without an explicit channel lands on
`beta`, an explicit `stable` publish is refused with `eval_gate_required`, and promoting to stable needs a passing
holdout comparison with the current stable version (`eval_gate_missing` or `eval_gate_failed` otherwise). Moving a
version back to beta is never blocked. See [Skill evals](17-skill-evals.md).

## Installing a specific version

`skillforge install type/name@spec` accepts:

| Spec | Resolves to |
|---|---|
| `@latest` | the highest stable version; also clears a pin |
| `@beta` | the highest version in any channel |
| `@1.2.3` or `@=1.2.3` | exactly that version |
| `@^1.2`, `@~1.2.0` and other semver ranges | the highest matching stable version |

A spec longer than 64 characters or with unexpected characters is refused with `spec_invalid`.

```bash
skillforge install skill/release-notes@^1.2 --runtime codex
skillforge install skill/release-notes@beta
skillforge install skill/release-notes@latest     # back to latest, pin removed
```

### Pins, sync and downgrades

Any spec other than `latest` is saved as `pin` in `.skillforge-lock.json`. `install` without a spec keeps the
existing pin, and `sync` resolves each pin instead of `latest`; an invalid pin in the lock is ignored with a
warning. Team method packs work the same way: `skillforge pack install team-method@1.0.0 --role developer`
installs each artifact at the version the pack names, and `sync` does not move those versions (in-app help:
`pages/packs`).

SkillForge never downgrades silently: `sync` skips an artifact whose resolved version is lower than the installed
one, and `install` exits with code 5 unless you pass `--allow-downgrade`.

`skillforge outdated` compares what is installed with the pinned (wanted) and the latest versions:

```bash
skillforge outdated --runtime claude-code
skillforge outdated --json
```

## Comparing versions

On the Versions tab, **Compare versions** shows which files were added, removed or changed between any two
versions, with a line diff of each changed text file; binary files are only marked as changed. By default it
compares the latest version with the one before it. Read the diff before you promote a candidate or move a beta
version to stable.

The same comparison is available from the API:

```bash
curl "$SKILLFORGE_URL/api/v1/artifacts/skill/release-notes/diff?from=1.2.0&to=1.3.0" \
  -H "Authorization: Bearer $SKILLFORGE_TOKEN"
```

The response lists each file with its status and a summary of the counts. An artifact with a single version
answers `nothing_to_compare`.

## Rolling back

To take a bad stable release away from everyone, move it to `beta`. The previous stable version becomes `latest`
again and nothing is deleted, so new installs, the marketplace and MCP get the previous version at once.

People who already installed the bad version keep it: downgrades are never silent, so `sync` skips the artifact.
They move back with `--allow-downgrade`:

```bash
skillforge sync --runtime claude-code --allow-downgrade
```

The usual fix is to publish a corrected version with a higher number; `sync` then updates everyone without the
flag.

## Replacing an artifact

When an artifact is outdated, set its successor with **Save successor** on its page, or with
`PUT /api/v1/artifacts/<type>/<name>/replacement` and `{"replaced_by": "skill/new-name"}`; send `null` to clear
it.

- The successor must exist, have the same type and not be the artifact itself; successors cannot form a cycle
  (`replacement_invalid`).
- Anyone who may publish versions of the artifact may set it; the change is audited as `replacement_set`.
- The catalog card shows **Replaced** and the page links to the successor.
- `skillforge install` of a replaced artifact prints a warning naming the successor.
- `skillforge sync` installs the successor and removes the replaced artifact (`replaced <old> -> <new>` on
  stderr), unless the user's team requires it.

Replacement does not change the lifecycle status. Retire the old artifact separately when nobody needs it
([Lifecycle and review](07-lifecycle-and-review.md)).

## See also

- [Publishing and import](06-publishing-and-import.md) — how versions get into the registry.
- [Agents](agents/README.md) — where installed versions land for each agent.
- [Glossary](glossary.md) — version, digest, channel, pin.
