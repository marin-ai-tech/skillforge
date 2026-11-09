---
title: E_SKILL_MD_MISSING
summary: Blocking error: the skill input does not contain exactly one SKILL.md, so there is no entry point for the agent and the version cannot be published.
related: pages/publish, actions/publish/issue-help
---

## What it means

Blocking error: skill input lacks exactly one SKILL.md (or one .md treated as SKILL.md). Severity label: **Blocking**. Issue codes are stable across API, UI, and import. On Publish, Blocking errors prevent a successful parse; Warnings annotate the result and should still be reviewed.

## Common causes

Wrong type selected; multiple markdown roots; empty upload. Confirm the selected artifact type and that paths match the canonical layout for skill (`skills/<name>/`), command (`commands/<name>.md`), agent (`agents/<name>.md`), and hook (`hooks/hooks.json`).

## How to fix

Include one SKILL.md at the package root after stripping a shared top folder. Re-run validation on the Publish page and confirm the issue disappears from the issue list (issue-help links back to this topic).

```
skills/pdf-tools/SKILL.md
skills/pdf-tools/references/guide.md
```
