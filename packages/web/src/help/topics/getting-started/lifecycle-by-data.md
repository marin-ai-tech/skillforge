---
title: Data-driven lifecycle
summary: How usage signals and ablation reports move artifacts between active, aging and zombie automatically, and what automation never does.
section: lifecycle
learn:
  - Which data rules can make an artifact zombie or revive it
  - How poisoning protection limits false signals
  - How to recover a zombie or turn data rules off
related: getting-started/lifecycle, pages/lifecycle, getting-started/lifecycle-hold-sweep, getting-started/ablation-report
---

Data-driven lifecycle moves artifacts between active, aging, and zombie using usage signals instead of only validation age. Reviewers still own retire and restore.

> [!NOTE]
> Automation never deletes files and never calls retire or purge.

## Rules

- **idle** — an aging artifact whose last activity is older than SKILLFORGE_ZOMBIE_IDLE_DAYS becomes zombie.
- **low_transfer** — transfer rate in the zombie window stays below SKILLFORGE_ZOMBIE_TRANSFER_RATE after requiring enough distinct reporters and capping each reporter contribution.
- **no_ablation_uplift** — the latest ablation report has enough tasks and uplift at or below zero.
- **revive by usage** — aging returns to active when enough usage events occur in the revive window. Zombie never auto-revives.

## Poisoning protection

Usage reports are capped per reporter and need several reporters before low_transfer can fire. Sweep applies at most SKILLFORGE_LIFECYCLE_MAX_PER_SWEEP automatic transitions. Owners cannot hold their own artifacts. MCP tokens cannot set holds. Reasons and metrics are written to audit.

## Marketplace and recovery

Zombie (and aging) stay hidden from default marketplace sync. A reviewer can transition zombie back to active, or retire with a reason from the cleanup board. SKILLFORGE_DATA_LIFECYCLE=off disables data rules and keeps validation-based aging only.

## Where to look

Open /lifecycle for the cleanup section "Clean up today", which lists each artifact with its status, the suggested action, the reasons and metrics behind it, and a Retire button.
