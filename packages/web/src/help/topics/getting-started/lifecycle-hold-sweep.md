---
title: Holds and dry run
summary: How to freeze automatic lifecycle transitions for one artifact and preview a sweep before it changes anything.
section: lifecycle
learn:
  - Who may set a hold and which limits apply
  - How to run a dry-run sweep
  - When to use a hold or a dry run
  - How the CLI mirrors holds and sweeps
related: getting-started/lifecycle-by-data, pages/admin-lifecycle, actions/lifecycle/lifecycle-hold-set, actions/lifecycle/sweep-run
---

A hold freezes automatic aging and zombie transitions for one artifact while manual transitions still work. Only reviewers and admins may set or clear holds, and the artifact owner cannot hold their own work because they are incentivized to keep a weak skill visible. Until must be a future ISO timestamp within 365 days; reason must be at least five characters. Active holds appear on the artifact lifecycle panel with author and expiry. Errors hold_invalid and forbidden are shown in plain language.

## Dry run and kill switch

Admins call POST /api/v1/admin/lifecycle/sweep with dry_run true to preview plan rows and counters without changing status. Real sweep requires confirmation in the UI ConfirmDialog. SKILLFORGE_DATA_LIFECYCLE=off turns off data zombie and revive rules while leaving validation-based aging. Thresholds such as SKILLFORGE_AGING_DAYS, SKILLFORGE_ZOMBIE_IDLE_DAYS, SKILLFORGE_ZOMBIE_WINDOW_DAYS, SKILLFORGE_ZOMBIE_TRANSFER_RATE, SKILLFORGE_ZOMBIE_MIN_REPORTERS, SKILLFORGE_ZOMBIE_MIN_USES, SKILLFORGE_ZOMBIE_RETIRE_DAYS, SKILLFORGE_ABLATION_MIN_TASKS, SKILLFORGE_REVIVE_WINDOW_DAYS, SKILLFORGE_REVIVE_MIN_EVENTS, and SKILLFORGE_LIFECYCLE_MAX_PER_SWEEP are shown on /admin/lifecycle. Invalid env values fail server start with the variable name.

## When to use

Set a hold during a release freeze or while investigating a false low_transfer signal from poisoned reports. Clear the hold when the investigation ends so the next hourly sweep can proceed. CLI mirrors the UI: skillforge lifecycle hold type/name --until ISO --reason text, --off to clear, and skillforge lifecycle sweep --dry-run for admins. Held artifacts increment the held counter in sweep results and never appear as automatic transitions until the hold expires.

> [!TIP]
> Prefer dry-run before enabling a new threshold or after bulk imports.