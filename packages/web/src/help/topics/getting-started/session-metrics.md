---
title: Usage metrics from sessions
summary: How the CLI counts registry skill usage in local agent sessions without uploading transcripts, and exactly what leaves your machine.
section: evidence
learn:
  - What the CLI parses locally
  - Which four fields are uploaded
  - How Verification Pass Rate is computed
  - How to delete your session facts
related: getting-started/evidence-and-usage, getting-started/cli, pages/me, pages/artifact, actions/me/sessions-delete
---

SkillForge can learn **how often registry skills are used in agent sessions** without uploading transcripts. Parsing happens **on your machine** in the CLI. Only a few fact fields leave the workstation, and only for skills whose names already appear in the registry you can see.

## What is parsed locally

Claude Code writes JSONL under `~/.claude/projects` (override with `SKILLFORGE_SESSIONS_ROOT` or `--root`). The `claude-code` adapter streams line-by-line, reads only `*.jsonl` inside the root, skips lines over 1 MiB and files over 200 MiB, ignores bad JSON, and **does not follow symlinks or junctions outside the root**. Nothing from a transcript is executed.

A skill call is a `tool_use` with `name: "Skill"` and `input.skill`. A skill preloaded to a subagent through its `skills:` field is seen in the subagent's log and counts too, with `basis: preloaded`; a call and a preload in one agent run are one fact. The metrics panel shows how many sessions only preloaded the skill. The verification window runs from that call until the next **different** skill or the end of the session. The last matching test/build command in the window sets `verification` to `pass`, `fail`, or `none`.

## What is uploaded

Each fact is exactly `{ skill, session_key, used_at, verification, basis }`. `session_key` is the first 32 hex characters of `sha256(sessionId)` — the raw session id never leaves your machine. Prompts, commands, paths, cwd, and private local skill names are never sent. Private local skills are counted only as `skipped_unknown` (a number, no names).

```bash
skillforge sessions import --dry-run --json
skillforge sessions import --harness claude-code
```

> [!TIP]
> `--dry-run` prints the same facts and uploads nothing.

Batches are at most 1000 facts; the server also caps the body at 512 KiB and 5000 **new** facts per user per UTC day.

## Definitions

- **Skill Age** — whole days from the first published version's `published_at` to now (shown on the artifact card and metrics panel).
- **Verification Pass Rate** — `round(pass / (pass + fail), 3)`, or "—" / null when there are no pass/fail outcomes (only `none`).
- **sessions_count** — distinct `session_key` values across reporters; **users_count** — distinct reporters.

## Command patterns (heuristic)

Verification matches (word boundaries, case-insensitive) include: `npm test`, `npm run test|build|lint`, `pnpm|yarn test|build|lint`, `node --test`, `npx playwright test`, `pytest`, `python -m pytest|unittest`, `go test`, `cargo test|build|check`, `make test|check|lint`, `mvn test`, `gradle test`, `dotnet test|build`, `tsc`, `eslint`, `ruff`, `phpunit`, `rspec`. Success requires `is_error` not true and no `Exit code` other than 0. This is an honest signal of "checks after apply", not a quality score for the skill.

## Limits and deletion

MCP tokens cannot upload or delete session facts. Use the cabinet panel **My sessions** (`me-sessions-delete`) or `DELETE /api/v1/me/session-facts` to remove your facts. Metrics on the artifact Overview update after the next refresh.

Supported harness in this version: **claude-code** only. Other runtimes can be added later as adapters without changing the four-field server contract.
