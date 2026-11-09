---
title: Hook runtime
summary: How the server-side hook runtime evaluates hook entries against tool calls, and its permissions and limits.
section: automation
learn:
  - How hook subscriptions are created and removed
  - Who may evaluate hooks and which decisions they return
  - How hooks run on Windows
  - How to turn the runtime off entirely
related: getting-started/hook-risks, getting-started/run-outputs, actions/artifact/install-runtime-unsupported
---

Artifact **hooks** (type `hook`) declare shell entries that the server-side
hook runtime can evaluate against tool calls — for example a pre-command
linter or a path guard. The runtime is part of the orchestration contour and
requires `SKILLFORGE_ORCHESTRATION_ENABLED`; when off, its API answers
`403 feature_disabled`.

## Subscriptions

`GET|POST /api/v1/hooks/subscriptions` lists and creates subscriptions
binding hook entries to matchers; `DELETE …/subscriptions/:id` removes one
— **unless** the subscription already produced audit decisions, in which
case the API answers `409 has_decisions` and you disable the subscription
instead. The decision audit is append-only and is never destroyed by a
delete; `GET /api/v1/hooks/decisions` lists it.

## Evaluation

`POST /api/v1/hooks/evaluate` runs matching entries against a tool-call
payload and returns the merged decision — `allow`, `ask` or `block` — with
per-entry results. Evaluation requires **contributor** rights or higher
(viewers cannot trigger host commands), and **MCP bearer tokens are banned**
(`403 mcp_token_forbidden`): machine tokens are for reading artifacts, not
for firing execution. Each entry runs with its own timeout, defaulting to
`SKILLFORGE_HOOK_TIMEOUT_S` (10 s).

A hook's own timeout or nonzero exit gives `ask`. If the gate itself cannot read
the hook's definition or files, or cannot start its process, the decision is
`block` with a detail starting `hook unavailable:`, so a broken gate does not let
a publish through. An admin clears it by disabling the subscription.

## Windows and kill switch

> [!NOTE]
> On Windows a hook command runs through `cmd.exe /d /s /c` with the whole command passed unchanged, so quoted paths and a data folder with spaces work. A **blocking** entry stops publishing there the same way as on Linux and macOS; write the command for `cmd.exe`, not for a Unix shell.

The operator can neutralize the runtime entirely with
`SKILLFORGE_HOOKS_DISABLED=true` (or `1`): evaluation then answers `allow` without
executing or auditing anything; the value is read at server startup.