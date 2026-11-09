---
title: Q_BODY_LONG
summary: Advisory: the main file is longer than about 5000 tokens, so it crowds the agent's context on every use; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types
---

## What it means

Advisory: the main file body is estimated at more than 5000 tokens (about 20 000 characters). Long bodies are loaded into the agent context on every use and crowd out the actual task. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Reference tables or API dumps inlined into `SKILL.md`; several unrelated workflows merged into one artifact; generated examples never trimmed.

## How to fix

Keep the main file to the instructions an agent needs on every run and move reference material into bundled files linked from the body (progressive disclosure). Split unrelated workflows into separate artifacts.

```markdown
See [references/API.md](references/API.md) for the full endpoint table.
See [references/FORMAT.md](references/FORMAT.md) for the output format.
```
