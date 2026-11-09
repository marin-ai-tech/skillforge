---
title: Q_REF_DEEP
summary: Advisory: a file referenced from SKILL.md points to yet another Markdown file, so the agent needs two hops to reach the content; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types
---

## What it means

Advisory: a file referenced from `SKILL.md` itself references another Markdown file in the bundle, so an agent needs two hops to reach the content. The report lists the second-level referencing file. Applies to skills only. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Reference files that link to each other (`references/A.md` → `B.md`); an index file pointing at chapter files; nested `docs/` trees copied from a repository.

## How to fix

Link every reference file directly from `SKILL.md` and keep reference files self-contained. Second-level links are resolved relative to the file that contains them, so `B.md` inside `references/A.md` means `references/B.md`.

```markdown
# SKILL.md
- [Format](references/FORMAT.md)
- [Examples](references/EXAMPLES.md)  <!-- linked directly, not from FORMAT.md -->
```
