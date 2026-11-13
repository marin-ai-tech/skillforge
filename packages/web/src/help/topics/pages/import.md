---
title: Importing artifacts
summary: Import finds skill, command, agent and hook packages in a zip, folder or git repository and publishes the selected ones in one pass. Use it instead of publishing packages one by one.
section: ui-catalog
learn:
  - How to choose a source and preview candidates
  - What the Ready, Warnings, Errors and Conflict statuses mean
  - How skip-conflicts and the provenance override work
  - Who may import and which server flags apply
related: getting-started/upload-artifacts, getting-started/provenance, pages/publish, actions/import/import-run, getting-started/tracked-sources
---

## What this page is for

Import scans a zip archive, a local folder, or a git repository for skill, command, agent, and hook packages, runs the same dry-run validation as Publish for each candidate, then publishes selected packages in one pass. Use it when you already have an agent folder (`.claude`, `.codex`, `.cursor`, `.opencode`, `.qwen`, `.reckon/skills`), a Claude plugin layout, or a git tree and want catalog entries with provenance and an audit `meta.import` record instead of uploading packages one by one on Publish.

## What you see

- Source selector (`zip`, `git`, or `folder`) with matching inputs: zip file picker, git URL/ref/path fields, or directory picker.
- Preview control that calls `POST /api/v1/imports/preview` and lists candidates with type, name, file count, and Ready / Warnings / Errors / Conflict status.
- Select-all and per-candidate checkboxes, optional provenance override, skip-conflicts (default on), and Import selected (enabled when at least one candidate is selected).
- Skipped paths (for example `node_modules`) and an error banner for API failures; after Import selected, results link created artifacts to their detail pages.

- For admins, **Import source policy** (`import-policy`): which git addresses are allowed, whether zip and folder uploads are allowed, and the minimum release age. An address outside the list gets `import_source_not_allowed`, an upload when uploads are off gets `import_archives_disabled`.
- A **Quarantine** note (`import-freshness`) when the commit is newer than the minimum release age. The age counts from when the registry first saw the commit, not from the date inside it, because the author sets that date. Running the import then gives `import_too_fresh`; an admin can import anyway with a reason that goes to the audit log.

- For admins, **Upstream mirrors** (`mirrors`): git sources the registry checks every day (`SKILLFORGE_MIRROR_INTERVAL_HOURS`) or with **Check now**. New packages arrive as candidates, changed packages as a new version in the `beta` channel, so people on `stable` get nothing until a reviewer moves it. Each check follows the source policy, the quarantine, the security scan and the hook gate; a check of a commit in quarantine reports when it can go. Deleting a mirror keeps the artifacts.

- A skill takes its whole folder: `SKILL.md` with everything beside it and in its subfolders. A zip or a git `path` that holds one skill folder gives one skill with all its files; a `SKILL.md` at the root of the upload takes every file that no other package claims (commands, agents, hooks and other skill folders stay separate). `node_modules`, `.git`, `dist` and `.skillforge-lock.json` never go in.

- Every package imported from git also gets a **tracked source** on its artifact page: the registry checks its folder for new commits and publishes a change as a version in the `beta` channel; local changes are kept as edit rules ([details](getting-started/tracked-sources)).

## Common tasks

1. Sign in as contributor or higher and open Import from the user menu (`menu-import`).
2. Choose zip and pick `plugin-sample.zip` (or git/folder), then click Preview.
3. Review Ready and Warnings rows; leave Conflict rows unchecked or rely on skip-conflicts.
4. Optionally set provenance override; leave blank to keep candidate provenance (for example reckon for `.reckon/skills`).
5. Click Import selected; open a created skill from the results list to confirm version and provenance.
6. Re-import the same source to see Conflict and skipped results when digests already exist.

## Permissions

Requires sign-in with contributor, reviewer, or admin. Viewers see `import-forbidden`. Anonymous users are redirected to Sign in with `next=/import`. Preview and run APIs return 401/403 for anonymous and viewer callers. Git and zip imports respect server env flags (`SKILLFORGE_IMPORT_GIT`, `SKILLFORGE_IMPORT_ALLOW_FILE_URLS`) and TTL for the temporary import id.
