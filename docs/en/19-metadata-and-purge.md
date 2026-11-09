# Metadata and purge

Published versions are immutable, but two things sometimes have to change after publishing: the card's display
details, and — after an incident such as a leaked secret — the stored content itself. This page covers editing
registry metadata without a new version, the irreversible purge of a version or an artifact, what a purge can and
cannot erase, and orphan blob cleanup.

## Edit metadata without a new version

An artifact's owner, a maintainer, a reviewer or an admin can change the card's **display name**, **description**
and **tags** without publishing a new version:

```bash
skillforge metadata set skill/pdf-tools --display-name "PDF tools" --description "Extract text and tables from PDFs" --tags pdf,docs
skillforge metadata set skill/pdf-tools --reset description
```

or `PATCH /api/v1/artifacts/:type/:name/metadata` with any of `display_name`, `description` and `tags`. The metadata
panel on the artifact page does the same, and every change is audited.

- These values are **registry overrides**. Published versions stay unchanged, and a later publish keeps the
  overrides.
- A field set to `null` (`--reset <field>` in the CLI) removes its override, and the card shows the latest
  surviving version's value again. Omitted fields are left as they are.
- Limits: display name up to 100 characters; description up to 1024; up to 20 unique tags of at most 40 characters,
  matching `^[a-z0-9][a-z0-9._-]{0,39}$`.

## Purge after an incident

Purge irreversibly erases one version or a whole artifact. It is meant for content that must not stay in the
registry, such as a leaked secret.

1. **First revoke the secret with its provider.** Purge removes the registry's copy; it cannot revoke a token or
   make anyone forget it.
2. An admin opens the artifact page and chooses **Purge version** or **Purge artifact**, or runs:

   ```bash
   skillforge purge skill/pdf-tools@1.2.0 --reason "Leaked credential in examples, revoked" --confirm skill/pdf-tools@1.2.0
   ```

   API: `POST /api/v1/artifacts/:type/:name/versions/:version/purge` or `POST /api/v1/artifacts/:type/:name/purge`
   with `{ "reason", "confirm", "delete_backups"? }`.
3. The reason must be 10–500 characters, and `confirm` must repeat the exact `type/name[@version]`
   (`confirm_mismatch` otherwise). **Do not put the secret in the reason**: the reason stays in the audit trail.

### What a purge erases

- The version's files and metadata (description, tags, frontmatter, changelog, quality, evidence), and related
  comments, notifications, review-assistant results, eval runs and results, session facts, usage reports, run
  outputs and provenance ledger entries.
- Reasons and details of earlier audit events for the purged content are redacted; the purge event itself is kept.
- What remains is a dated tombstone with the version number, the digest and who purged it when.
- A whole-artifact purge also removes the artifact's eval suite, workflows, routines, hook subscriptions, watchers,
  overlays, team availability and lifecycle holds, clears the card and reserves the name. Other users see the artifact as absent; a
  purged version answers `410`.

### Blobs and backups

- Registry blobs used only by the purged content are deleted. A blob that other, unpurged versions still use is
  kept; the response lists such shared blobs with their hashes and versions. Blob deletion failures are reported.
- Backups made before the purge may still contain the deleted data; the response names them in
  `backups_predating`. With `delete_backups: true` (`--delete-backups`, or the checkbox in the dialog) the existing
  registry backup archives are deleted in the same operation and listed in `backups_deleted`.
- Outside the registry's reach: bundles people downloaded earlier, local installations, client caches, file-system
  snapshots and external backups. Read the purge result and have their owners remove these copies.

Server plugins must handle the `artifact.purged` event to erase data they keep themselves
([Server plugins](14-plugins.md)).

## Orphan blob cleanup

`POST /api/v1/admin/blobs/gc` scans for blobs that no version references and deletes those older than a grace
period (`grace_days`, 7 by default, at most 365). The request is a dry run unless it sends `"dry_run": false`, so you
can preview the result first. Cleanup never deletes shared blobs or backup archives.

## See also

- [Versions and channels](10-versions-and-channels.md)
- [Backups and operations](20-backups-and-operations.md)
- [Quality and security](09-quality-and-security.md)
- [Server plugins](14-plugins.md)
- [Cookbook](21-cookbook.md) — the purge recipe
- [Admin handbook](handbook/admin.md)
