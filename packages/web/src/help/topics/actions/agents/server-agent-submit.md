---
title: Create server agent
summary: Creates a server agent from an absolute path on the host after validating it against the allowed roots and running a first scan. Use it to attach agent folders SkillForge can read on disk without a browser upload.
related: pages/admin-agents, getting-started/agents
---

## What it does

Submits name, absolute server path, and runtime to create a server agent under the admin owner after root and realpath validation and an initial scan.

## When to use

Use this to attach agent folders on CI or the host (for example `.claude` or `.codex`) that SkillForge can read on disk without browser upload.

## Requires

Admin role and `SKILLFORGE_AGENT_ROOTS` enabled. Paths outside roots return `path_outside_roots` in `admin-error`.