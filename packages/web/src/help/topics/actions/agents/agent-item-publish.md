---
title: Publish item from agent
summary: Publishes a local-only or modified item from your agent snapshot into the registry, recording the agent as provenance. Use it to add a skill, command, or agent to the catalog without leaving the UI.
related: pages/me-agent, getting-started/agents, getting-started/provenance
---

## What it does

Publishes a `local_only` or `modified` snapshot item into the registry through the normal publish pipeline, recording provenance `{ source: "agent", ref: "<agent>" }`.

## When to use

Use this after reviewing the local files when you want the catalog to gain the skill, command, or agent without leaving the cabinet UI.

## Requires

Contributor role or higher, plus ownership of the agent. Confirm the dialog; conflicts surface as `agent-error` with the API code.