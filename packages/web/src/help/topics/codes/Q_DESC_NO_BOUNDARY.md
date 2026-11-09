---
title: Q_DESC_NO_BOUNDARY
summary: Advisory: the description never says when not to use the artifact, so agents may load it for neighbouring tasks; it lowers the quality score but never blocks publication.
related: pages/publish, getting-started/artifact-types
---

## What it means

Advisory: the `description` does not say when the artifact should *not* be used. Without a boundary, agents load it for neighbouring tasks it was never meant to handle. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Descriptions that cover only the happy path; overlapping skills without a hint about which one to prefer; boundaries described in the body only.

## How to fix

Add a short boundary using phrases such as `Do not use`, `Not for`, `Not intended for`, `Instead use`, `Skip when` or `unless`. One clause is enough.

```yaml
description: Use when the user asks to rotate API keys. Not for SSH keys; instead use the ssh-rotate skill.
```
