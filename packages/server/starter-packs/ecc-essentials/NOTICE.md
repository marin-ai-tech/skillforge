# NOTICE

This starter pack contains a SkillForge edition of third-party skills under the MIT License (see `LICENSE`, copyright Affaan Mustafa).

## Source repository

- affaan-m/ECC @b38be6a7f6350964d59328b52f0624e1d1d552d1

Files were downloaded on 06.11.2026 from that commit; each file's git blob hash was checked against the commit tree before editing.

## Skills

- change-impact: affaan-m/ECC @b38be6a7f6350964d59328b52f0624e1d1d552d1 path skills/change-impact
- architecture-decision-records: affaan-m/ECC @b38be6a7f6350964d59328b52f0624e1d1d552d1 path skills/architecture-decision-records
- codebase-onboarding: affaan-m/ECC @b38be6a7f6350964d59328b52f0624e1d1d552d1 path skills/codebase-onboarding

Selected from eight candidates. Not included because of unsafe or wrong examples or a too narrow scope: database-migrations, api-design, error-handling, security-review, verification-loop.

## Local changes

Differences from the source repository:

- change-impact: removed references to skills and artifacts that exist only in ECC (`contract-first`, `test-collaboration`, `module-regression`; MAP, STATUS, LOG, CONTEXT, CONTRACT, TESTS, REGRESSION); reading and read-only inspection (`git log`, `git blame`, `git grep`, `git diff`, listing and searching files) no longer need extra approval; added a boundary ("Do not use for …") to the description; added `investigating-repository-history` as a related skill.
- architecture-decision-records: removed `metadata.origin: ECC`; replaced the planner and code reviewer agents of ECC with neutral planning and code review steps; for a past decision the history is checked first and the record says "rationale unknown" instead of inventing one; added a boundary to the description.
- codebase-onboarding: removed `metadata.origin: ECC`; the onboarding guide is printed in the conversation and no file is written by default; the agent instructions file is written only on explicit request, only into the file the project already uses (for example `AGENTS.md` or `CLAUDE.md`) and after the user confirms; wording made agent-neutral; added a boundary to the description; the boundary names both sides: the agent instructions file (`AGENTS.md`, `CLAUDE.md`) is in scope on request, agent settings, permissions and hooks are not (finding of the model review on 06.11.2026).

## Not done yet

- The benefit of these skills has not been measured with evals (epic step A3); it needs the operator's runners. A skill may leave the pack after A3.
- Updating to a newer ECC commit repeats steps A1 to A4 of the epic; there is no automatic update.
