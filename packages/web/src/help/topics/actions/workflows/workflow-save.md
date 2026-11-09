---
title: Save workflow definition
summary: Validates and stores a workflow definition of command steps with success and failure branches. Use it to create or update a step chain; only admins may save.
related: actions/workflows/workflow-run-start, actions/evals/eval-save
---

## What it does

Validates the JSON definition (`version: 1`, `command` steps with argv, `on_success` /
`on_failure` branching) and stores it under the artifact. Invalid ids, unresolved references,
cycles, unreachable steps and `SKILLFORGE_*` env names are rejected with an error list.

## When to use

To create or update a step chain before starting a run on the Workflows tab. Only an
**admin** may save or delete definitions; owners and maintainers can still run approved
workflows.

## Requires

Admin. Other roles with manage rights can list and run approved definitions, but saving
returns `403 forbidden`.
