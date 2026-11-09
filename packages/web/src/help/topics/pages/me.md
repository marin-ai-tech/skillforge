---
title: My workspace
summary: My workspace is your personal home after sign-in. It gathers your artifacts, agent snapshots, token counts, recent activity and, for reviewers, the review queue on one page.
section: ui-workspace
learn:
  - What each section of the workspace shows
  - How to jump to tokens, agents and the lifecycle board
  - Which sections depend on your role
  - What the overview never exposes about tokens
related: actions/me/menu-me, actions/me/me-tokens-manage, actions/me/me-review-open, pages/tokens, pages/me-agents, getting-started/overview, getting-started/roles
---

## What this page is for

My workspace (`/me`) is your personal cabinet home in SkillForge. After you sign in, open it from the user menu to see your published artifacts by lifecycle status, agent inventory snapshots that need attention, API token counts, recent audit activity on artifacts you own or events you performed, and—if you are a reviewer or admin—the candidate review queue. The page loads a single authenticated overview from `GET /api/v1/me/overview` so you do not hop between `/me/tokens`, `/me/agents`, and `/lifecycle` just to answer "what is mine?" and "what needs me?". Use it as the daily starting point before browsing the public catalog or publishing something new.

## What you see

- Profile block (`me-profile`) with username, optional display name, and role chip (`me-role`).
- Artifacts section (`me-artifacts`) with status count chips (`me-artifacts-count-<status>`) for candidate, active, aging, zombie, and retired, plus rows (`me-artifact` with `data-key`) linking to artifact pages and showing raw status text (`me-artifact-status`). Empty state `me-artifacts-empty` offers a publish link only for contributor and above.
- Agents section (`me-agents`) listing snapshots (`me-agent` with `data-name`) linked to `/me/agents/<name>`, an attention badge when outdated or modified items exist, or empty guidance mentioning `skillforge agent scan`.
- Tokens summary (`me-tokens`) with active and never-used counts plus `me-tokens-manage` to `/me/tokens` (no secrets or hashes).
- Review queue (`me-review`) only for reviewer/admin: pending count, candidate items, and `me-review-open` to `/lifecycle`.
- Recent activity (`me-activity`) up to twenty events with actor, action, and artifact identity, or `me-activity-empty`.

## Common tasks

1. Sign in and click My workspace (`menu-me`) as the first item in the user menu.
2. Scan status chips to see how many of your packages sit in each lifecycle state.
3. Open an artifact row to review versions, files, and audit history.
4. Follow Manage API tokens when CLI automation needs a new Bearer secret.
5. If you hold reviewer or admin, open the lifecycle board from the review queue to promote or reject candidates.
6. When agents show attention, open My agents to rescan, publish local-only items, or install outdated packages.
7. Read recent activity to confirm a teammate transitioned something you published.

## Permissions

Any signed-in role can open `/me`; anonymous visitors are redirected to `/login?next=%2Fme`. The overview never exposes token secrets, prefixes, names, or hashes. Review queue data appears only when your role rank is reviewer or admin. Publishing from the empty artifacts state requires contributor or higher. Viewer accounts still see token counts and agent guidance without publish or review controls.
