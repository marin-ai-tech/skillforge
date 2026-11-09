---
title: Admin lifecycle policy
summary: The lifecycle policy page shows the active data-lifecycle thresholds and runs a policy sweep. Use a dry run to preview which artifacts would age, become zombie or revive before applying it.
section: ui-admin
learn:
  - What the policy table settings mean
  - How to preview a sweep with a dry run
  - How to run a real sweep safely
  - Who may open this page
related: getting-started/lifecycle-by-data, getting-started/lifecycle-hold-sweep, actions/lifecycle/sweep-run
---

## What this page is for

Route /admin/lifecycle lets administrators inspect the active data-lifecycle policy and run a policy sweep. Use dry-run to preview which artifacts would age, zombie, or revive before applying changes. Real runs require ConfirmDialog confirmation. Thresholds come from SKILLFORGE_* environment variables validated at server start.

## What you see

- Policy table with aging_days, zombie windows, transfer-rate threshold, ablation minimum tasks, revive settings, and max_per_sweep.
- Enabled banner, or the word "disabled" when SKILLFORGE_DATA_LIFECYCLE is off.
- Buttons sweep-dry-run and sweep-run; results show plan rows plus aged, zombied, revived, held, and deferred counters.
- Confirm dialog before a real sweep; dry-run never asks for confirmation.
- Panel `security-policy`: whether a failed content scan blocks publishing, import and agent uploads.
- Panel `mcp-policy`: which package types (`npm`, `pypi`, `oci`) an MCP server may run from and which remote origins (`https://host` or `https://*.domain`) are allowed; without any origin, remote MCP servers are not published (`E_MCP_POLICY`).

## Common tasks

1. Open Lifecycle policy from the admin user menu.
2. Confirm thresholds match the intended rollout.
3. Click Dry run and review plan rules such as low_transfer.
4. Confirm Run sweep only after the dry-run plan looks right.
5. Check /lifecycle cleanup for new zombie rows afterward.

> [!WARNING]
> A real sweep changes the status of every artifact in its plan. Always run Dry run first and review the plan rows before you confirm.

## Permissions

Admin role required. Reviewers use holds and the cleanup board but cannot open this page. MCP tokens cannot call mutating admin sweep routes beyond normal admin session or API token auth rules already enforced by the server.
