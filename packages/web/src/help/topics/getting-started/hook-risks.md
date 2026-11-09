---
title: Hook risks
summary: Hooks run on their own and can block tools, write files or reach the network. This guide explains the risk table reviewers read before promoting a hook.
section: publishing
learn:
  - What each column of the hook table means
  - How SkillForge classifies blocking modes
  - What each risk label detects
  - Which quality codes apply to hooks
related: getting-started/artifact-types, codes/Q_HOOK_NO_TIMEOUT, codes/Q_HOOK_HARD_BLOCK, codes/Q_HOOK_BROAD_MATCHER, codes/Q_HOOK_INLINE_LONG
---

A hook is the riskiest artifact type: it runs on its own, without the agent asking for it, and it can block tools and prompts, write files and reach the network. SkillForge therefore adds a `hook` section to the quality report of every hook: a table with one row per handler and a list of risk labels. Reviewers use it to decide whether to move a hook to `active` without reading raw `hooks.json`.

## The table: event → condition → action

Each row corresponds to one handler `hooks.<Event>[i].hooks[j]` in the order of `hooks.json`:

| Column | Meaning |
|---|---|
| `event` | When it fires (`PreToolUse`, `UserPromptSubmit`, `Stop`, …). |
| `matcher` | Condition on the tool name (regular expression); `null` means every tool. |
| `type` | `command`, `http`, `prompt` or `agent`. |
| `action` | The command, URL, prompt text or agent name, cut to 200 characters. |
| `timeout` | Seconds before the runtime gives up, or `null`. |
| `script` | Bundle file referenced through `${CLAUDE_PLUGIN_ROOT}/…`, if it exists. |
| `blocking` | `block`, `ask`, `none` or `unknown` (see below). |
| `runtimes` | Runtimes from the catalog that support both the event and the type (today: `claude-code`). |

## Blocking modes

Only some events can stop the agent: `PreToolUse`, `PermissionRequest`, `UserPromptSubmit`, `PostToolUse`, `Stop`, `SubagentStop`. For `command` handlers on those events SkillForge reads the referenced script (or the inline command) and classifies it:

- `block` — the text contains `exit 2`, `"decision": "block"` or `"permissionDecision": "deny"`; the hook refuses without asking.
- `ask` — the text contains `"decision": "ask"` or `"permissionDecision": "ask"`; the user confirms.
- `none` — nothing of the above, or an event that cannot block.
- `unknown` — `http`, `prompt` or `agent` handlers on a blocking event: the decision is made by a server or a model and cannot be read from the bundle.

SkillForge prefers `ask` to a hard block ("ask, not deny"): a hook that blocks silently hides why the agent stopped, cannot be overridden for a legitimate case, and turns a heuristic into a hard rule. `Q_HOOK_HARD_BLOCK` lowers the score for `block` rows; `ask` costs nothing.

## Risk labels

Labels list the table rows they apply to (0-based) and appear in a fixed order. `writes_files` and `network` are matched on the cleaned text of the command or script: comment lines are dropped and the contents of quoted strings are replaced by `_`, so a pattern such as `case "$cmd" in *"rm -rf /"*)` does not count as a write.

- `blocks_tools` — `blocking = block` on `PreToolUse` or `PermissionRequest`. Example: a guard that `exit 2`s on `rm -rf`.
- `blocks_prompts` — `blocking = block` on `UserPromptSubmit`. Example: a script that prints `{"decision":"block"}` when the prompt contains a private key.
- `writes_files` — the cleaned text contains a redirection (`>` or `>>`, but not `>&2`, `2>&1` or `/dev/null`), `tee`, `rm `, `mv `, `cp `, `sed -i`, `Set-Content`, `Add-Content`, `Out-File`, `Remove-Item`, `New-Item` or `writeFile`. Example: `echo "$input" >> "$HOME/.claude/audit.log"`.
- `network` — the handler type is `http`, or the cleaned text contains `curl`, `wget`, `nc`, `Invoke-WebRequest`, `Invoke-RestMethod`, `http://`, `https://`, `fetch(` or `requests.`. Example: `curl -s -X POST https://telemetry.example.com/events`.
- `every_prompt` — the handler runs on every turn: `UserPromptSubmit`, `SessionStart`, or `PreToolUse` / `PostToolUse` without a matcher or with `*`. Example: a `PreToolUse` group with no `matcher`.
- `llm_hook` — the handler type is `prompt` or `agent`: a model decides, which costs tokens and is not deterministic. Example: `{ "type": "prompt", "prompt": "Confirm no destructive command is running." }`.

## Quality codes for hooks

- `Q_HOOK_NO_TIMEOUT` (warn) — `command` or `http` handler without `timeout`.
- `Q_HOOK_HARD_BLOCK` (info) — a row with `blocking = block`.
- `Q_HOOK_BROAD_MATCHER` (warn) — `PreToolUse`, `PostToolUse` or `PermissionRequest` without a matcher or with `*`.
- `Q_HOOK_INLINE_LONG` (info) — inline command longer than 200 characters without a bundle script.

All of them are advisory: they lower the score and grade but never block publication.

> [!WARNING]
> The analysis is text-based and deterministic; it does not run the hook, so unusual scripting styles can produce false positives or misses. Treat labels as a reading guide, not a verdict, and open the script when a label surprises you.