---
title: Publishing an artifact
summary: Publish creates a new immutable version of an artifact from uploaded or pasted files. Read it to pass validation, choose a version and provenance, and stay within the limits.
section: ui-catalog
learn:
  - How to stage files and fill type, name, description and version
  - What Blocking and Warning issues mean for Submit
  - Which size and naming limits apply
  - How provenance and autoversioning work
  - Who may publish and who promotes the candidate
related: getting-started/upload-artifacts, getting-started/artifact-types, actions/publish/submit, getting-started/provenance, getting-started/quality, getting-started/duplicates
---

## What this page is for

Publish is the UI for `POST /api/v1/artifacts`. Contributors upload or paste a package, validate it, and create a new immutable semver with a content digest. New artifacts start in **candidate** status for reviewer endorsement. Validation emits Blocking `E_*` and Warning `W_*` codes with help links. Hard limits: 32 MiB total, 16 MiB per file, at most 1000 files; names 1-64 characters of `a-z0-9-`; descriptions at most 1024 characters. Omitting version auto-assigns `0.1.0` or patch+1. Conflicts `version_exists` and `digest_exists` leave prior versions untouched. Provenance source must be one of human, reckon, agentspace, dreamteam, import, agent or harvest.

## What you see

- Mode switches for upload versus paste (and related publish modes).
- Fields for type, name, description, optional version, changelog, and provenance source/ref.
- Staged files list with sizes; live issue list showing Blocking errors and Warnings with issue-help links.
- A file that looks like a secret by its name (`.env`, a private key, credentials) stops the upload before anything is sent ([E_SECRET_FILE](codes/E_SECRET_FILE)).
- After dry-run validation, Quality (`publish-quality`) and Possible duplicates (`publish-duplicates`) blocks appear; they are advisory and do not change whether Submit is enabled.
- Submit control posting to the artifacts API using the session cookie (CLI may use Bearer tokens instead).
- Success navigates toward the new artifact detail; failures keep the form and highlight issues.

## Common tasks

1. Sign in as contributor, reviewer, or admin and open Publish.
2. Choose type and stage files (for skills include `SKILL.md` under the package root).
3. Align name with frontmatter and folder rules; set a non-empty description.
4. Leave version blank for autoversion or set a fresh unused semver without a `v` prefix.
5. Set provenance when the package came from another source (reckon, agentspace, dreamteam, or import); otherwise leave human.
6. Review advisory quality grade and duplicate hints; they never disable Submit by themselves.
7. Clear every Blocking issue, submit, then ask a reviewer to promote the candidate on Lifecycle.

## Permissions

Requires sign-in with contributor, reviewer, or admin. Viewer receives 403 forbidden on publish. Anonymous users must Sign in first. API tokens shaped `sf_…` authenticate CLI publish as the token owner with the same role rules. Lifecycle promotion after publish requires reviewer or admin.
