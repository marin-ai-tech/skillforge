---
title: Q_HOOK_HARD_BLOCK
summary: Advisory: a command hook on a blocking event refuses outright instead of asking the user to decide; it lowers the quality score but never blocks publication.
related: getting-started/hook-risks, pages/publish, getting-started/artifact-types
---

## What it means

Advisory: a `command` handler on a blocking event (`PreToolUse`, `PermissionRequest`, `UserPromptSubmit`, `PostToolUse`, `Stop`, `SubagentStop`) decides outright instead of asking. SkillForge reads the script referenced by the command (or the inline command itself) and treats `exit 2`, `"decision": "block"` and `"permissionDecision": "deny"` as mode `block`. The hook table on the artifact page shows the mode per handler and the `blocks_tools` / `blocks_prompts` risk labels. Severity label: **Advisory**. Quality codes (`Q_*`) come from the prompt-quality report, not from the validator: they never block publication, never appear in `errors` or `warnings`, and only lower the advisory `score`/`grade` shown next to the artifact. The penalty is charged once per code, however many places it fires in.

## Common causes

Guard scripts written as hard filters (`exit 2` on any match); copying deny-lists from CI; not knowing that Claude Code supports `"decision": "ask"`, which pauses for the user instead of silently refusing.

## How to fix

> [!TIP]
> Follow the "ask, not deny" principle: return `ask` and a reason so the user decides, and reserve `block` for cases that are never acceptable.

If a hard block is really required, say so in the README so reviewers understand why.

```sh
# before
echo '{"decision":"block","reason":"dangerous"}'; exit 0
# after
echo '{"decision":"ask","reason":"rm -rf on a top-level path; confirm?"}'; exit 0
```
