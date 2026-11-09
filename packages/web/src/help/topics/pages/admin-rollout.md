---
title: Rollout through pull requests
summary: The rollout page opens a pull request in each chosen GitHub repository with the files of active artifacts and the CLI lock file, so repository owners can review and merge them.
section: ui-admin
learn:
  - What a rollout pull request contains
  - How the GitHub token is configured
  - How results are reported per repository
  - How the repository stays up to date afterwards
related: getting-started/self-hosting, pages/admin-inventory, pages/admin-audit
---

## What this page is for

Connecting every repository by hand does not scale: someone has to run `skillforge install --into`, commit the files and the lock and send them for review. Here an admin lists repositories and active artifacts, and the registry opens one pull request per repository with exactly what `install --into .claude` would write: the artifact files under `.claude/skills`, `.claude/commands` or `.claude/agents` and the `.claude/.skillforge-lock.json` lock file. An existing lock is extended, not replaced. Repository owners review and merge as usual; the default branch is never changed directly.

## What you see

- A notice (`rollout-not-configured`) when the server has no GitHub token.
- Two fields: repositories (`rollout-repos`), one `owner/name` per line, and artifacts (`rollout-artifacts`), one `type/name` per line — skill, command or agent, active only.
- The button that opens the pull requests (`rollout-start`).
- The list of rollouts with a result per repository (`rollout-result`): a link to the pull request, or the reason it failed.

## Common tasks

1. Ask the server operator to set `SKILLFORGE_GITHUB_TOKEN` (and `SKILLFORGE_GITHUB_API_URL` for GitHub Enterprise) in the server environment.
2. Open the page from the user menu (`menu-admin-rollout`) or go to `/admin/rollout`.
3. List repositories and artifacts, then click the button.
4. Follow the links to the pull requests; fix access for the failed ones and run the rollout again for them.
5. After merging, keep the repository up to date with `skillforge sync --into .claude`.

> [!WARNING]
> The token can write to the repositories it has access to. Give it the narrowest scope that allows creating branches and pull requests. It is read from the environment only and is never shown or stored.

## Permissions

Requires role admin. Other roles get 403 from the API and see the forbidden state here; anonymous visitors are sent to sign in. Every rollout is recorded in the audit log as `rollout_create`.
