---
title: "Purge: removing leaked data"
summary: Purge permanently removes leaked content from the registry. Read it before responding to a leak, because the order of steps matters.
section: operations
learn:
  - What to do before purging leaked data
  - What a version or artifact purge removes and what remains
  - How purge affects metrics, holds and eval suites
  - What purge cannot reach, such as shared blobs and old backups
related: pages/artifact, actions/artifact/purge-version, actions/artifact/purge-artifact
---

> [!CAUTION]
> Purge is an irreversible administrator action for leaked content. **First revoke the exposed secret** at its provider; removing registry copies cannot invalidate a credential already copied by someone else.

> [!WARNING]
> Never put the secret itself in the reason: the reason remains in the audit log.

Use a clear reason of 10 to 500 characters and type the exact `type/name@version` or `type/name` into the confirmation field. The submit button stays disabled until both are valid, and the server checks them again.

A version purge removes its files, description, display name, tags, frontmatter, changelog, evidence, quality details, comments, notifications, review data, session facts, and usage reports for that version. The version number, digest, publish provenance, audit trail, and a dated tombstone remain. A whole artifact purge applies this to every version, clears card metadata, and reserves the name permanently. Non-admin users see a whole purged artifact as not found. A purged version cannot be read or installed again, but a locally installed copy stays on that user's disk until they remove it.

Purge cascades into data derived from the erased rows. Deleting the session facts and usage reports of a purged version lowers usage metrics (the metrics dashboard and the personal cabinet) and the lifecycle activity signals computed from that data, so the artifact may look less used to lifecycle-by-data review; the cached use and help counters of the tombstone are not recomputed. A whole artifact purge also removes its watchers and its lifecycle hold, while the maintainer list stays with the tombstone for the ownership audit. Evaluation suites and cases survive a version purge so a required eval gate is not silently dropped, and are deleted with the whole artifact.

Blobs referenced by another unpurged version are **shared** and remain available to that version. The result lists each shared SHA-256 and the referencing versions. Administrators must decide whether those versions also need purge. Deletion failures are reported separately. Earlier backups may still contain the deleted content; the result lists backups predating purge. The optional delete-backups choice removes existing registry archives, but external filesystem snapshots, client caches, clones, and downloaded copies are outside registry control.

After the incident, inspect the result and plan follow-up. Blob garbage collection at `POST /api/v1/admin/blobs/gc` removes orphan blobs after a retention grace period, seven days by default; dry-run can preview the count. GC does not remove shared blobs or existing backups. New publications are guarded against reintroducing a purged digest or a whole purged artifact name. Plugins receive `artifact.purged` and should delete their own associated content. Purge is appropriate only after the secret is revoked and the scope of the leak is understood.
