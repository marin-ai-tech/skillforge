---
title: Acceptance gate
summary: The acceptance gate keeps a weaker change from becoming the stable version consumers receive. Read it before turning the gate on.
section: evidence
learn:
  - What changes for publishing when the gate is required
  - What a promotion to stable needs to pass the gate
  - Who may turn the gate on and off
  - How gate failures appear on the Versions tab
related: getting-started/skill-evals, getting-started/eval-runs-runners, getting-started/channels-and-pinning, actions/evals/eval-gate-toggle
---

The **acceptance gate** (`gate: required` on a skill’s eval suite) stops a weaker change from becoming the default `stable` version consumers receive. It applies after a suite exists; the first publish of a brand-new skill is unaffected because there is no suite yet.

## What required does

With the gate on:

1. Publish or import without an explicit channel lands the new version on **beta**, even when the semver has no pre-release suffix.
2. Publishing with explicit `channel: "stable"` fails with `409 eval_gate_required`.
3. Promoting `beta → stable` when another stable head already exists requires a completed **compare** run of that version against the stable head, `scope: holdout`, status `done`, `errors = 0`, executed after the version was published and after the suite was last changed, with candidate `task_pass_rate` and `trigger_accuracy` at least as good as the baseline (trigger side skipped if a side has no trigger cases). Otherwise the channel API returns `409 eval_gate_missing` or `409 eval_gate_failed` with `reason` (`errors`, `task_regression`, or `trigger_regression`).
4. If there is no prior stable head, the compare requirement is waived for the first stable. Demoting `stable → beta` is never blocked by the gate. Zero holdout cases make promotion report missing (`no_holdout_cases` style missing) — enable required only after you mark holdout cases.

## Who can toggle the gate

Any eval manager (owner, maintainer/coauthor, reviewer, admin) may set `gate: required` when holdout cases exist. **Turning the gate off** (`required → off`) is limited to **reviewer+ or admin**. Owners who try to disable it from the Evals tab see a clear message; the API answers `403 forbidden` and must not look like success. Reviewers use the same `eval-gate` control or `skillforge evals push … --gate off`.

## UI on the Versions tab

When promote-to-stable fails for gate reasons, the Versions list shows a short human message next to the channel button and a link to the **Evals** tab so you can run holdout compare or fix regressions. Typical copy: need a holdout compare before stable; regression on tasks/triggers; or gate missing entirely.

## Operational advice

Keep holdout cases representative of real traffic, not duplicates of training prompts. Watch the journal row for the version: gate status appears as passed, failed, missing, or not applicable.

> [!NOTE]
> Pair gate discipline with evidence and reviews — the gate measures suite metrics, not full product safety.

> [!TIP]
> Re-run compare after every suite edit before promoting.