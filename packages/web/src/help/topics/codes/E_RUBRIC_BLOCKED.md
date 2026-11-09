---
title: E_RUBRIC_BLOCKED
summary: Blocking error: the company's or team's quality rules refuse this version because its score is below the threshold. Read it to see which rules failed and how to meet them.
related: getting-started/quality, pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: the version is refused because its score by the company quality rules is below the threshold and the rules are set to block. Severity label: **Blocking**. The score is 100 minus the weights of everything not met: quality checks `Q_*` with the weights the company chose, and the company's own criteria. For an artifact of a team, the team's rules apply too; a team can only make them stricter.

## Common causes

A required section is missing (`require_heading`), a required file such as `README.md` is not in the artifact (`require_file`), the text contains a phrase the company forbids (`forbid_phrase`), or quality checks the company weighs heavily failed, for example `Q_NO_EXAMPLE`.

## How to fix

Open the validation result: the rules block lists the score, the threshold and every failed item with its weight. Fix the items with the largest weights first, then validate again. If a rule does not fit the artifact, ask an admin (company rules) or the team lead (team rules).

```
Before:  # notes
         Do it.
After:   # notes
         ## Limits
         Only plain text.
```
