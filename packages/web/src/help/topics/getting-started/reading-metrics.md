---
title: How to read metrics
summary: What each metric on the board and the card measures and where its data comes from. Metrics are signals, not proofs.
section: evidence
learn:
  - What Ablation Score, Skill Age, VPR and Transfer Rate mean
  - Why Token Efficiency is only an estimate
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

## Transfer Rate

Transfer Rate is helped ÷ uses across usage reports for all versions (`null` when uses = 0). Source: usage evidence (`POST …/usage`). It answers “of reported uses, how often did it help?”—still self-reported by clients.

## Token Efficiency (estimate)

Token Efficiency is an **estimate**, not measured model spend. `token_cost = ceil(sum of text file sizes / 4)` for `.md/.txt/.json/.yaml/.yml/.toml` on the latest non-purged version; `token_efficiency = round(transfer_rate / (token_cost / 1000), 3)` when transfer_rate and token_cost are available. API marks `token_cost_estimated: true`. UI labels it "estimate". Prefer it to compare relative “help per kilotoken of skill text,” not to bill tokens.

## Where to look

- Board: `/metrics` (filters, sort, export).
- Card: MetricsPanel fields `metric-ablation-score`, `metric-skill-age`, `metric-verification-pass-rate`, `metric-token-efficiency`.
- CLI: `skillforge metrics [--json|--csv]` against the same overview and export APIs.
