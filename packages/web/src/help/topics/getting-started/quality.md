---
title: Artifact quality
summary: The advisory quality report attached to every version lowers a score and grade but never blocks publishing. Use it as a reading guide before promotion.
section: publishing
learn:
  - How the score and the A to D grade are derived
  - What a quality check contains and where its help opens
  - How hook analysis and duplicates appear in the report
  - Where the report appears in the UI
related: getting-started/hook-risks, getting-started/duplicates, pages/artifact, pages/publish, codes/Q_DESC_SHORT
---

SkillForge attaches an advisory quality report to every validated or published version. Authors and reviewers use the Quality tab, catalog grade chips, and the Publish preview to see the same numbers the API already stores.

> [!NOTE]
> The report never blocks publication: Blocking `E_*` codes still decide whether a package is valid, while `Q_*` checks only lower an integer score and a letter grade from A to D.

## Score and grade

The quality algorithm hashes description length, body size estimates, reference depth, and hook handler patterns into a score. Grades map roughly to lifecycle risk: A looks clean (often shown with the same green tokens as active), B is acceptable with minor notes, C needs attention, and D is weak enough that reviewers should pause before promoting. List endpoints expose only `{ score, grade }` on `ArtifactSummary.quality`; the full report with checks, metrics, and optional hook analysis lives on `VersionDetail.quality` for the selected version.

## Checks and help topics

Each check has a code, severity (`warn` or `info`), a short message, and optional hits with path and line. The UI lists up to five hits as `path:line` and shows `+N more` when truncated. The Help control next to a check opens `codes/<CODE>` in the help panel, matching the pattern used for validation issues. Codes such as `Q_DESC_SHORT` explain how to expand a thin description; hook codes explain timeouts, hard blocks, broad matchers, and long inline commands.

## Hooks and duplicates

When the artifact is a hook, the report includes a table of handlers (event, matcher, type, action, timeout, blocking, runtimes) plus risk labels that highlight related rows. Registry duplicates for the latest version appear under Possible duplicates via `GET /api/v1/artifacts/:type/:name/duplicates`. On Publish, validate responses already include `quality` and `duplicates` so you can see grade D findings and identical-body matches before submit without changing whether publish-submit is enabled. Agent snapshots separately list replica, divergent, and stale_backup groups on the agent page.

## Where it appears in the UI

Open `?tab=quality` on any artifact, look for grade chips on catalog cards and the me cabinet when quality is present, review Publish quality and duplicates blocks after dry-run validation, and inspect agent duplicates when a snapshot reports colliding roots. Treat the report as a reading guide: fix the underlying markdown or hooks, republish, and confirm the score moves before promoting lifecycle status.

## Security scan

Every version also gets a built-in security scan, shown first on the Quality tab and as a risk chip on catalog cards. It looks for patterns that hurt the people who install an artifact: commands that download and run code, text that tells an agent to override its instructions or hide things, sending secrets out, hidden Unicode characters, keys pasted into the text, paths to credentials, destructive commands and flags that skip checks. Each finding names its rule, file and line; a key in a finding is shortened.

The verdict is **pass**, **warn** or **fail**. A line that only warns about a pattern is marked as a mention and gives **warn**, never **pass**, so writing "never" in front of an attack does not hide it. The scan does not change the A–D grade.

> [!WARNING]
> A pass means none of these patterns were found, not that the artifact is safe. Review still decides.

An admin can make a failed scan block publishing, import and agent uploads (`E_SECURITY_BLOCKED`). The CLI warns about **warn** and refuses to install a **fail** without `--allow-risky`.

## Context cost

The Quality tab also estimates how many tokens the artifact puts into the agent's context, with the same estimate as `body_tokens_est`. **Every turn** is the name and description: the agent keeps the list of skills, commands and agents in its context all the time, so a long description costs on each turn of every session. **When used** is the body of the main file, read when the artifact is called. **Other files, on demand** are reference files the agent reads only when it needs them. Hooks, settings and MCP server descriptions cost nothing here: their scripts, `settings.json` and `server.json` do not enter the model's context (the tool descriptions a running MCP server sends do, but SkillForge does not measure them). A plugin adds up its components.

The level is **high** when the description costs more than 200 tokens or the body more than 5000, **medium** above 100 or 2500, otherwise **low**. A high level shows a "Costly context" chip on catalog cards. To lower it, shorten the description and move details into reference files.

## Company quality rules

An admin can set company rules on the lifecycle admin page: a threshold from 0 to 100, a mode (off, warn, block), weights for quality checks and the company's own criteria — a required section heading, a required file such as `README.md`, or a forbidden phrase. The score is 100 minus the weights of everything not met; a failed check without a weight costs 15 (warning) or 5 (note). In block mode a version below the threshold is refused with `E_RUBRIC_BLOCKED`; in warn mode it is published and the score is shown. The score is kept with the version and shown on the Quality tab.

A team lead can add rules for the team's artifacts on the team page. They can only be stricter: the threshold, mode and weights cannot go below the company's, otherwise the server answers `rubric_looser`. An artifact of a team gets both rule sets together. Every change of the rules is recorded in the audit log.
