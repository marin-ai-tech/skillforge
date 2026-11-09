---
title: Evidence and usage
summary: How evidence links and usage reports turn impressions about a skill into data. Both feed the Evidence tab and the Transfer Rate.
section: evidence
learn:
  - Which evidence kinds exist and which links are accepted
  - Who may add evidence and how gate evidence sets validated_at
  - How usage reports produce the Transfer Rate
  - How to report usage from the CLI and MCP
related: getting-started/versions-and-digests, getting-started/lifecycle, getting-started/cli, getting-started/mcp, actions/artifact/evidence-add
---

Decisions about a skill should rest on objective data, not on impressions. SkillForge collects two kinds of data for every published version: **evidence** — links to results that prove something about the version — and **usage reports** — "applied N times, helped M times". Both are shown on the artifact page in the Evidence tab (`?tab=evidence`).

## Evidence records

An evidence record belongs to one version and has a `kind`, a `url`, an optional `summary` (up to 500 characters), and the author and time. The kinds are:

- `gate` — the result of a quality gate or eval suite the version passed;
- `run` — a run log or CI job;
- `diff` — a diff or pull request with the change;
- `review` — a human or model review;
- `eval` — an evaluation report.

The `url` must start with `https://` or `http://`, or be a registry path starting with `/`, and is at most 2048 characters. Anything else (`javascript:`, `data:`, `//host`, `ftp://`) is rejected with `url_invalid`. The server records `at` and `by` itself from the clock and the signed-in user; values sent by a client are ignored. Adding the same `kind` and `url` twice changes nothing. A version holds at most 100 records (`evidence_limit`); a retired artifact accepts no evidence (`artifact_retired`). Records written before this feature have no author or time and show "unknown".

## Who may add evidence

Evidence can be added by whoever may publish versions of the artifact: the owner and maintainers, plus reviewers and admins as an override that is written to the audit log as `publish_override`. Every addition writes `evidence_add` with the kind and link. MCP tokens cannot add evidence, and MCP has no evidence tool.

## Gate evidence and validated_at

A `gate` record sets the version's `validated_at` to its time; other kinds do not. This is self-attestation by the author: it says "my gate passed", and the link is the proof reviewers can open. Reviewer validation with model compatibility (`version-validate`) stays a separate action.

## Usage reports and Transfer Rate

Any signed-in user, viewers included, can report usage: `uses` (0–100000) and `helped` (0–`uses`), optionally for a specific version (default: latest), a `source` label (≤ 64) and a `report_id` (≤ 128). The version counters `use_count` and `help_count` are the sums of all reports. **Transfer Rate** = helped / uses, rounded to three decimals and shown as a percentage, or `—` when there are no uses. The Evidence tab shows it for the selected version and for all versions together, and a **By source** table (`usage-by-source`) splits the reports of all versions by `source` with the number of reports and reporters: an agent's self-reports through MCP (`mcp`) stay apart from reports made by people or scripts (`api`, `cli`, `hook`). A report can state its `basis`: `loaded` (really applied) or `assigned` (only assigned to a role). An `assigned` report gets its own row without a rate and changes neither the counters nor Transfer Rate; a report without the field counts as before. A note under the table says when part of the uses came without reports, for example from an import.

> [!TIP]
> A repeated `report_id` from the same author is recorded once, so a client can safely retry.

Each author can send at most 200 reports per artifact per UTC day (`rate_limited`).

## CLI and MCP

```bash
skillforge report-usage skill/pdf-tools --uses 10 --helped 7 --report-id run-2026-09-29-1
skillforge evidence add skill/pdf-tools@1.2.0 --kind gate --url https://ci.example/runs/42 --summary "evals 18/20"
skillforge evidence add skill/pdf-tools@1.2.0 --kind review --file ./review.md
```

A result you keep locally (a `verification.md` or `review.md`) can be attached as an evidence document instead of a link: `--file` in the CLI, a text file in the Evidence form, or `document: { name, text }` in the API. The text (UTF-8, up to 64 KiB) is stored in the registry and the record links to it. MCP accepts no evidence: agents report through `record_usage`.

Exit codes: 0 success, 2 invalid arguments, 4 not signed in or not allowed, 6 not found, 1 `not_owner` (the message names the owner), 3 no registry configured. Agents can report usage through the MCP tool `record_usage` (`type`, `name`, optional `version`, `uses`, `helped`, optional `report_id`); such reports have source `mcp` and only work for active artifacts visible to the token.

> [!CAUTION]
> Never put secrets, tokens or private URLs with credentials into a summary, a link or a report id: they are shown to every reader of the registry.