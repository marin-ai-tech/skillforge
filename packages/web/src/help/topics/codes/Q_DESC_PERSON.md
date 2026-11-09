---
title: Q_DESC_PERSON
summary: Advisory: the description is written in the first or second person, while agents match third-person task wording better; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types
---

## What it means

Advisory: the `description` is written in the first person (`I can...`, `We will...`) or addresses the reader with `you can use this`. Descriptions are matched by an agent, not read by a person, so third-person task wording works better. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Text copied from a chatbot self-introduction; marketing-style copy (`I help you ship faster`); descriptions written for humans browsing the catalog.

## How to fix

Rewrite the description as an impersonal statement of the task, trigger and boundary. Move any conversational tone into the body if it is needed at all.

```yaml
# before
description: I can help you write release notes.
# after
description: Use when the user asks for release notes from a git range; not for changelog linting.
```
