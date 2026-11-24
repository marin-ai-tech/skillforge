---
title: Quality tab
summary: Opens the Quality tab with the version's score, grade, checks, metrics, hook table, and duplicates. Use it when reviewing a candidate or investigating a poor score.
related: pages/artifact, getting-started/quality, getting-started/hook-risks, actions/quality/quality-check-help, actions/quality/security-clearance-form, actions/quality/security-clearance-remove
---

## What it does

Opens the Quality section on an artifact detail page so reviewers can read the selected version score, grade, advisory checks, metrics, hook table, and registry duplicates without leaving the catalog UI. The tab is linked with `?tab=quality` for shareable review URLs.

## When to use

Use when promoting a candidate, comparing versions after a publish, or investigating why a skill scored poorly before asking authors to revise the description or hook handlers. Prefer this tab over raw API JSON when walking a lifecycle review.

## Requires

Readable for any viewer who can open the artifact page. No elevated role is required to read quality data; publishing a new version still needs contributor or higher.

## Security clearance

When the security verdict is fail, the tab shows a Security Clearance block. Anyone can read its state. A reviewer or admin who is not the publisher of the version (an admin who published it may still act) can mark the blocking findings as false positives with a reason, or remove a current mark after confirmation. The mark unblocks becoming active, assignment to a team and entry into a pack, and it replaces `--allow-risky` for everyone; the verdict itself stays fail. The mark stops being current when a later scan finds a blocking finding the mark does not cover.
