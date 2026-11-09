---
title: Versions and digests
summary: Why every published version is immutable and how content digests prove that nothing changed. Read it before publishing or pinning a version.
section: publishing
learn:
  - How file and bundle digests are computed
  - How autoversion picks the next version number
  - Why the same bytes or version string cannot be published twice
  - How to share a link to an exact snapshot
related: getting-started/overview, getting-started/provenance, actions/artifact/version-select, getting-started/channels-and-pinning
---

SkillForge versions are immutable. An artifact identity is `type + name`. Each publish adds a semver `version` and a content `digest` that never change afterward. Re-uploading the same bytes is rejected with `digest_exists`; reusing a semver string is rejected with `version_exists`. Same names of different types remain separate identities (skill `deploy` versus command `deploy`).

## Digests

File digest equals SHA-256 of file bytes (64 lowercase hex). Bundle digest equals SHA-256 of the canonical concatenation of `path\0fileDigest\n` lines sorted by path. Digests are deterministic across machines and file order. Blobs are stored content-addressed under `blobs/<two hex chars>/<sha256>` and are never overwritten for an existing digest.

## Autoversion

If you omit version on publish: first version becomes `0.1.0`; later publishes bump patch relative to `latest_version` (for example `0.1.0` to `0.1.1`). You may set an explicit unused semver without a `v` prefix. `latest_version` is the maximum semver in the `stable` channel (a lower historical number never replaces it); beta versions do not become latest unless the artifact has no stable version at all. See getting-started/channels-and-pinning.

## UI

On the artifact page, `version-select` chooses which snapshot Overview and Files display. The Versions tab lists digests, publish times, and actors. Audit records publish actions with digest metadata. Digest collisions are a signal to stop and compare bytes rather than force a rewrite.

> [!TIP]
> Sharing `?version=1.2.3` pins a link to that immutable snapshot.

## Why it matters

Digests make "did anything change?" a cryptographic answer. Combined with provenance and evidence fields, they support ablation and install trust. CLI and marketplace flows consume the same version objects the UI shows, so what you verify in the browser matches what automation installs.

## Comparing versions

On the Versions tab, **Compare versions** (`version-compare`) shows what changed between any two versions: which files were added, removed or changed, and a line diff of each changed file. By default it compares the latest version with the one before it. Review the diff before promoting a candidate or moving a beta version to stable. To go back, move the newer version to the `beta` channel: the previous stable version becomes the latest again, and nothing is deleted. The same comparison is available as `GET /api/v1/artifacts/:type/:name/diff`.
