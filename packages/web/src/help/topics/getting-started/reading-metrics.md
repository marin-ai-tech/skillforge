---
title: How to read metrics
summary: What each metric on the board and the card measures, where its data comes from, and how a skill did in each agent (Claude Code, OpenCode) and model (Opus, Sonnet), in sessions and in evals. Metrics are signals, not proofs.
section: evidence
learn:
  - What Ablation Score, Skill Age, VPR and Transfer Rate mean
  - Why Token Efficiency is only an estimate
  - How a skill did in each agent and model (Claude Code, OpenCode; Opus, Sonnet), and why some numbers are hidden
  - Which agent and model solve eval tasks best across the registry
  - Where to find metrics in the UI and CLI
related: pages/metrics, pages/artifact, getting-started/session-metrics, getting-started/evidence-and-usage
---

SkillForge metrics are **signals**, not proofs.

> [!WARNING]
> A high Transfer Rate or Ablation Score suggests a skill helped in reported usage or A/B-style ablation, but it does not certify correctness, safety, or production fitness. Always read numbers next to evidence, reviews, and ownership context on the artifact card.

## Ablation Score

Ablation Score is the `uplift` from the latest ablation evidence report on the artifact (or empty when none). Positive uplift means the full skill beat an ablated variant in that report. Source: ablation evidence attached to the artifact. Treat it as an experimental signal from whoever filed the report—not a global ranking.

## Skill Age

Skill Age is days since the artifact first appeared in the registry (from creation). Older skills are not automatically better or worse; age mainly helps lifecycle boards and stale-candidate cleanup. Source: registry timestamps on the artifact record.

## Verification Pass Rate (VPR)

VPR is the share of session facts with verification `pass` among pass+fail outcomes (`none` excluded from the rate). Source: imported session facts (`skillforge sessions import`). Empty when there are no pass/fail outcomes. It reflects local test/build heuristics in the harness window, not a formal QA gate.

## By agent

The card's metrics tab also splits the session facts by the agent they were imported from (`by_runtime` in the API): sessions, users, VPR and last use per agent. The agent comes from `skillforge sessions import --harness`; a fact whose source is not a known agent goes to one **Other sources** row, and the source text itself is not shown. When a row has one user and the skill has more, its VPR shows **Hidden: one user**: the share would be that person's. Different people use different agents for different tasks, so read a difference between rows as a hint to look closer, not as proof that one agent is better.

## By model

Under **By agent**, the **By model** table (`by_model`) splits the same sessions by agent and the model that called the skill, as `skillforge sessions import` reports it. A model is named only when at least two people in the registry reported it; any other model, and sessions without one, count as **Other or not reported**. The pass rate of a one-user row is hidden as in **By agent**. Compare models of one agent first: the same model behaves differently in another agent.

## Agents and models in evals

Reviewers and admins see this section at the bottom of `/metrics` (`GET /api/v1/evals/summary`). It compares eval runtimes across the registry on equal terms: each row is one runtime (an agent and a model from the runners file), built from the latest finished ablation run of each skill on it — the same tasks with and without the skill. A row shows the skills and tasks counted, the share solved with and without the skill, the uplift and the cost per solved task. Compare runs of two versions and older runs of the same pair are left out. Runtimes may have evaluated different skills, so compare rows with a similar number of skills. Without eval runs the section explains how to start them: runtimes in the server's runners file (`SKILLFORGE_EVAL_RUNNERS_FILE`) and a task suite on a skill's Evals tab.

## Transfer Rate

Transfer Rate is helped ÷ uses across usage reports for all versions (`null` when uses = 0). Source: usage evidence (`POST …/usage`). It answers “of reported uses, how often did it help?”—still self-reported by clients.

## Token Efficiency (estimate)

Token Efficiency is an **estimate**, not measured model spend. `token_cost = ceil(sum of text file sizes / 4)` for `.md/.txt/.json/.yaml/.yml/.toml` on the latest non-purged version; `token_efficiency = round(transfer_rate / (token_cost / 1000), 3)` when transfer_rate and token_cost are available. API marks `token_cost_estimated: true`. UI labels it "estimate". Prefer it to compare relative “help per kilotoken of skill text,” not to bill tokens.

## Where to look

- Board: `/metrics` (filters, sort, export).
- Card: MetricsPanel fields `metric-ablation-score`, `metric-skill-age`, `metric-verification-pass-rate`, `metric-token-efficiency`, and the table `metrics-by-runtime`.
- CLI: `skillforge metrics [--json|--csv]` against the same overview and export APIs.
