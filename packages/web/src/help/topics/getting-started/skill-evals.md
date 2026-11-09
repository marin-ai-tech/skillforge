---
title: Skill evals
summary: How to measure whether a skill version is ready before it becomes the stable head, using trigger, task and holdout cases.
section: evidence
learn:
  - How trigger and task cases are scored
  - Why holdout cases matter for the acceptance gate
  - How to edit a suite on the Evals tab
  - Who may manage a suite and which limits apply
related: getting-started/eval-runs-runners, getting-started/eval-gate, pages/artifact, actions/evals/eval-save
---

SkillForge **skill evals** let owners and reviewers measure whether a skill version is ready before it becomes the default `stable` head. An eval suite is a single replaceable document on the skill: a list of cases plus an optional acceptance gate. Suites exist only for `type=skill`. Other artifact types return `type_not_supported`.

## Trigger and task cases

A **trigger** case asks whether the skill should activate for a user prompt. You set `expect_trigger` to true or false. The operator runner returns `{ triggered: boolean }`. The server scores recall (fired when it should), specificity (stayed quiet when it should), and accuracy across the selected cases.

A **task** case checks the runner’s textual `output` with deterministic string checks: `contains`, `not_contains`, or `equals`. Optional `ci` ignores case. You may attach one to ten checks per task case. Regular expressions are intentionally unsupported (ReDoS and false confidence). There is no LLM-as-judge in the core registry.

## Holdout cases

Mark a case with **holdout** when it must not be used to tune a change that is about to be promoted. Holdout cases back the acceptance gate’s compare requirement. Non-managers never see suite routes at all, so holdout prompts stay off the public card for ordinary readers.

> [!IMPORTANT]
> Enabling `gate: required` without any holdout case fails with `gate_needs_holdout`.

## What you manage in the UI

On the skill card, open the **Evals** tab (`?tab=evals`) if you can publish versions (owner, maintainer/coauthor, reviewer, or admin). Edit case id (kebab), kind, prompt, holdout, expect_trigger or checks, then **Save suite**. Human-readable errors surface `suite_invalid` detail and `gate_needs_holdout`. The tab is hidden for non-skills and for users who cannot manage evals.

## Permissions and limits

Managing the suite requires the same rights as publishing a version. Turning the gate from `required` to `off` is stricter: only reviewer+ or admin. File size for push/API bodies is capped at 256 KiB and at most 100 cases.

> [!TIP]
> Prefer small, stable prompts and checks that mirror real consumer asks rather than overfitting to a single model answer.

## Related flows

After the suite exists, run trigger, compare, or ablation from the same tab or via `skillforge evals run`. Read **Eval runs and runners** for runner protocol and **Acceptance gate** for beta→stable rules. See also `docs/en/17-skill-evals.md` in the repository for operator configuration of `SKILLFORGE_EVAL_RUNNERS_FILE`.
