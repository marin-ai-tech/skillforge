---
title: Editing metadata without a version
summary: How to correct an artifact's display name, description, tags or agent list without publishing a new version, and how to reset an edit.
section: publishing
learn:
  - Who may edit registry metadata
  - How an override differs from a reset
  - Which limits apply to names, descriptions and tags
  - How to edit metadata from the CLI
  - How to change or reset the agents an artifact is for
related: pages/artifact, actions/artifact/metadata-save
---

Registry metadata is the current caption on an artifact card: display name, description, tags, and the agents the artifact is for. The owner, a maintainer, reviewer, or administrator can edit it without creating another version. A new publish does not erase these edits. Published version files and their original metadata remain immutable; this action changes only the effective catalog values. Search uses the effective values, so changes become visible to people browsing the registry.

The edit is stored as a registry override. Each supplied field replaces its current override. A field omitted from a request stays as it was. Reset sends `null` for that field, removes its override, and restores the value from the latest surviving version. You can reset description, display name, tags, and agents independently.

> [!NOTE]
> Saving a blank value is different from resetting: a blank description or display name is an explicit override.

Display names are limited to 100 characters. Descriptions are limited to 1024 characters, with no control characters other than a newline. Tags are comma separated in the form and an array in the API. Up to 20 unique tags are allowed; each has at most 40 lowercase letters, digits, dots, underscores, or hyphens and begins with a letter or digit. Invalid metadata is rejected with a field error. An empty request is also rejected.

The Agents field holds the author's list of agents in the same form as `skillforge publish --agents`, for example `claude-code>=2.1, codex`; see [Agent support](getting-started/agent-support). An empty list means every agent the type installs into. The list is checked as at publish: an unknown agent, a malformed version, a repeated agent, or an agent the type does not install into is rejected with `agents_invalid`, and the reason appears under the field. Reset agents sends `null` and brings back the list declared with the latest version. In the API the field is `agents` (a list or a comma-separated string); each change is recorded in the audit log as `metadata_change`, like the other fields.

The CLI equivalent is `skillforge metadata set skill/name --description "New caption"` or `--reset description`; the agent list is edited in the panel or through the API. Neither operation increments the version count. The server checks ownership and role; a hidden button is not an authorization mechanism. MCP tokens cannot edit metadata.

> [!CAUTION]
> The audit log records changed fields, so keep descriptions and tags free of secrets. If data has leaked in a version, editing a caption cannot remove that version's files; see the purge guidance instead.