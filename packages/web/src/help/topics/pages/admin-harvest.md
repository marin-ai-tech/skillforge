---
title: Rules from past reviews
summary: The page collects rules that reviewers keep repeating in pull request comments and turns them into a draft skill with links to the comments, published as a candidate for the usual review.
section: ui-admin
learn:
  - What counts as a recurring rule
  - Where the evidence links come from
  - How a draft reaches the review queue
  - How to collect rules from your own sessions
related: pages/admin-rollout, pages/lifecycle, getting-started/cli
---

## What this page is for

Teams repeat the same review remarks — "always add a timeout to HTTP calls" — in pull request after pull request, and the knowledge stays in comments. Here an admin collects such rules from the review comments of a GitHub repository over a period, using the same GitHub connection as rollouts (`SKILLFORGE_GITHUB_TOKEN`). A rule is a sentence that starts like a rule (`always`, `never`, `don't`, `avoid`, `use`, `prefer`, `must`, `should`) and recurs at least 3 times in at least 2 pull requests. Code blocks and quoted lines are ignored, so an example inside a comment does not count.

## What you see

- The repository field (`harvest-repo`), the number of days back (`harvest-days`) and the button (`harvest-run`).
- Each collection (`harvest`): its rules (`harvest-rule`) with how many times and in how many pull requests they occurred, and links to the comments as evidence.
- A name field and a button (`harvest-draft`) that publish the rules as a candidate skill.

## Common tasks

1. Open the page from the user menu (`menu-admin-harvest`) or go to `/admin/harvest`.
2. Enter `owner/name`, choose the period and collect the rules.
3. Read the rules and their evidence; if they are worth keeping, give the skill a name and make a draft.
4. Review the draft like any candidate: edit it, then a reviewer moves it to active.
5. To collect rules from your own agent sessions, run `skillforge harvest sessions --out <dir> --name <name>`: it reads only what you typed in local Claude Code logs, writes a draft on disk and sends nothing.

> [!NOTE]
> A draft is published with `provenance.source = harvest` and status candidate. Nothing collected here reaches people's agents before a reviewer accepts it.

## Permissions

Requires role admin. Other roles get 403 from the API and see the forbidden state here; anonymous visitors are sent to sign in. Each collection is recorded in the audit log as `harvest_create`.
