---
title: Artifact page
summary: The artifact page presents one artifact and a selected version. Use it to read documentation and files, compare versions, check quality and evidence, install, and manage lifecycle status.
section: ui-catalog
learn:
  - What each tab shows, from Overview to Evidence
  - How to switch versions and compare digests
  - How reviewers promote, retire and restore from the lifecycle panel
  - Which roles may publish, transition, validate and add evidence
related: pages/catalog, getting-started/versions-and-digests, getting-started/lifecycle, getting-started/quality, actions/artifact/tabs, actions/quality/tab-quality, getting-started/evidence-and-usage
---

## What this page is for

Route `/artifacts/:type/:name` presents one artifact identity and a selected immutable semver. Use it to read rendered documentation, inspect canonical files, compare versions and digests, read audit events, and manage lifecycle status. The lifecycle panel under the header shows the current status and, for reviewer+, transition buttons such as promote, retire, and restore. Tab and version query parameters keep links shareable. Missing artifacts show the not-found page with `data-testid="not-found"`.

## What you see

- Header fields `detail-name`, `detail-type`, `detail-status`, `detail-version`, and `detail-description`.
- Lifecycle panel `lifecycle-panel` with optional `transition-*` buttons for reviewer and admin.
- Version selector `version-select` defaulting to `latest_version`.
- Tabs `tab-overview`, `tab-files`, `tab-versions`, `tab-audit`, `tab-install`, `tab-quality`, `tab-evidence` and `tab-comments` mirrored in the `tab` query parameter; those who may manage evals also see `tab-evals`, and with orchestration on `tab-workflows` and `tab-routines`. Enabled server plugins may add their own tabs.
- Overview may also show `replaced-by` (the successor of a replaced artifact), `availability` (which teams get the artifact by default or as required) and `overlays` (your layers of edits that install and sync apply over the published files).
- Versions has `version-compare`: pick two versions to see added, removed and changed files (`compare-summary`) and the diff of each file.
- For an `mcp-server`, Overview adds the section `mcp-card`: package and version or remote address, variables marked secret or required, tools, whether the version matches the current MCP policy, and how many installs the inventory has seen (counts only).
- Overview stacks its blocks at full width: the rendered main file, usage and quality metrics, then the metadata (description, tags, version, digest, author, provenance, changelog).
- Overview also has the Agents section `artifact-agents`: one row per runtime with Installs (yes, or the reason the type does not install there) and Listed by the author (yes, from a version, or a dash); the hint above the table says whether the author listed agents ([details](getting-started/agent-support)).
- The metadata panel, for those who may edit metadata, has an Agents field with the author's list in the form `claude-code>=2.1, codex` and a Reset agents button ([details](getting-started/metadata)).
- Files shows the file tree and the selected file; markdown files open rendered with the frontmatter as a table, and the Rendered / Source switch shows the exact file ([details](actions/artifact/file-view-mode)).
- Evidence tab shows the selected version's evidence records with author and time, the usage panel with uses, helped and Transfer Rate (plus usage by source), a usage report form for signed-in users, and `evidence-form` for those who may publish the version.
- Quality tab shows selected-version grade, score, advisory checks with help links, the security scan verdict and findings (`quality-security`), the context cost (`quality-context`: tokens every turn, when used, and other files on demand), metrics, optional hook table with risk highlights, and latest-version registry duplicates. The Evals tab adds the cost per solved task by runner (`eval-cost`).
- Install tab shows, for active artifacts, the install command for the agent picked in `install-runtime-select` and the Claude Code plugin marketplace commands (the only agent with a plugin marketplace), direct `.tar.gz`/`.zip` downloads, and download counts; non-active artifacts show `install-not-active`.
- Versions entries may show `version-validate`, `version-validated-at`, and model compatibility chips.
- Audit entries include transition from/to statuses and reasons. The browser tab title is the artifact name followed by · SkillForge.

## Common tasks

1. Open from Catalog, Home, or Lifecycle, or navigate directly to a known type/name.
2. Confirm type, status, and description in the header and lifecycle panel.
3. As a reviewer, promote a candidate with `transition-active` and an optional reason. If you published the latest version yourself, the button is disabled with a hint (`self-promotion-hint`): another reviewer promotes it; an admin can, with a required reason.
4. On Versions, validate a semver with model compatibility tags when evals pass.
5. On Audit, verify transition and validate events including actors and reasons.
6. Open Install, pick your agent and copy its install command, or download archives; Overview shows `meta-downloads`.
7. Open Versions and use `version-compare` to see what changed between two versions; `version-select` switches the version shown on every tab.
8. Open Quality (`?tab=quality`) before promoting a candidate to review grade, checks, hook risks, and duplicates.
9. Open Evidence (`?tab=evidence`) to read gate, run, diff, review and eval links and the Transfer Rate, or to add evidence to your version.
10. Check the Agents section on Overview before you install into an agent the author did not list.

## Permissions

Readable under public read or signed-in viewer+. New versions require contributor+. Lifecycle transitions and version validation require reviewer or admin. Bearer tokens inherit the owner role for API access. Contributors see the lifecycle panel status without transition buttons. Usage reports require any signed-in user; evidence requires the owner, a maintainer, or reviewer+ as an audited override. The metadata panel, including the Agents field, is for the owner, a maintainer, or reviewer+.
