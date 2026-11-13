---
title: Independent review assistant
summary: The review-assistant plugin adds an independent, evidence-backed review by several models, and a reviewer decides each finding.
section: lifecycle
learn:
  - How a review run, its judge and its findings work
  - Which four decisions a reviewer can make on a finding
  - How operators configure reviewers safely
related: getting-started/self-hosting, getting-started/plugins, actions/plugins/ext-action-run
---

The review-assistant plugin gives SkillForge an independent, evidence-backed review step. A reviewer starts a **run** for a version with **Run review** on the plugin tab, or the plugin starts one on every publish when the admin turns on `auto_on_publish`: several external reviewers, each a different model, audit the prompt against a checklist. A **judge** merges their findings into one list with an agreement measure (how many of the reviewers agreed on each finding), and a **reviewer** then decides each finding. The finished run is stored as evidence on the version, so the review survives as part of the artifact's history.

## What a run looks like

A run has a summary and findings. Each finding carries a category, the file and line where it was spotted (within three lines), a severity, the agreement count, and a suggestion. The reviewer resolves every finding with one of four decisions: **Fix** the artifact, **Verify** the plausible claim with a targeted check, **Defer** it with a reason, or **Reject** it as disproven, duplicated, or a matter of taste. Decisions are recorded with the author's name.

## Configuring reviewers

Reviewers are defined in a JSON file whose path is given by `SKILLFORGE_REVIEWERS_FILE`. The plugin reads that file on every run, so operators can add or remove models without restarting the server. Each entry names the model, the command to launch, and any environment to pass.

> [!WARNING]
> Reviewers **must run without tools**, so they cannot read the operator's files, tokens, or call the network.

Examples:

- Claude Code: `claude -p` with an empty tool list and `--output-format json` — the reply arrives as an object with a `result` string.
- Codex: `codex exec --sandbox read-only`.

The plugin spawns reviewers directly (no shell), passes an environment allow-list plus the entry's own `env`, and kills the whole process tree on timeout.

## Skill checks with a model

If an LLM is connected on the Assistant page and skill checks are on, every published skill version gets a background run with the single reviewer `llm`, with no reviewers file needed. Publishing does not wait for it. The first time a connection is set up, checks turn on by themselves; a connection set up before this feature stays off until an admin turns them on.

The answer is checked strictly: one JSON object of the expected shape, and every finding must quote its file word for word; the line comes from that quote. If any finding breaks this, the whole answer is rejected as `invalid_output` — a model that invented one quote may have invented others. With Agent Space, checks can also be paid from a task budget: such runs may wait for a version to be published (`awaiting_publication`) or stop after a server restart (`interrupted`) until Agent Space resumes them. A wrong answer, a provider error, a timeout or a used-up daily budget mean the skill was not checked, not that it is clean. Repeat a check with **Check with model** on the Review tab, and check older skills with **Check published skills** on the Assistant page.

> [!IMPORTANT]
> A check does not change the status and does not count as review evidence. No findings does not mean a skill is safe: models make mistakes, and a skill's own text can try to influence them. A reviewer decides.

Only skills are checked. The full text of a checked skill goes to the provider, including skills visible to one team.
