# Handbook by role

This handbook tells each person what they can do in SkillForge and walks through their everyday tasks, with the
pages to open and the commands to run. Find your role below, read its chapter, and use the guides by topic when you
need the full detail of a feature.

## On this page

- [The four roles](#the-four-roles)
- [Chapters](#chapters)
- [Which role to grant](#which-role-to-grant)
- [Sessions, tokens and roles](#sessions-tokens-and-roles)
- [Rights that do not come from the role](#rights-that-do-not-come-from-the-role)
- [Before you start](#before-you-start)
- [See also](#see-also)

## The four roles

Roles have a total order: **viewer** < **contributor** < **reviewer** < **admin**. A higher role can do everything a
lower role can.

| Role | In one line | Main pages |
|---|---|---|
| viewer | reads the catalog, installs active artifacts, connects agents, keeps agent snapshots | Home, Catalog, artifact page, My workspace, API tokens, My agents |
| contributor | also publishes new versions and imports packages | Publish, Import, the artifact's Versions, Evidence and metadata panels |
| reviewer | also changes lifecycle status and validates versions | Lifecycle, First-run guide, the artifact's lifecycle panel |
| admin | also manages users, teams, policies, plugins, backups and operations | Users, Teams, the admin pages in the user menu |

## Chapters

- [Viewer](viewer.md): find, read and install artifacts; connect an agent; take an agent snapshot; report usage.
- [Contributor](contributor.md): publish, import, ship a beta, maintain your artifacts.
- [Reviewer](reviewer.md): work the review queue, promote or reject, keep the delete-today board clean.
- [Admin](admin.md): first run, users and teams, policies, inventory and reports, backups and incidents.

Each chapter starts with what the role can do and then gives step-by-step tasks.

## Which role to grant

- Grant **contributor** to authors who need to publish skills, commands, agents and other artifacts.
- Grant **reviewer** to people who endorse candidates and decide what stays active.
- Keep **admin** tightly held. The last active admin cannot be demoted or disabled (`409 last_admin`).
- **Viewer** is enough for read-only stakeholders and for people who only install. When public read is enabled,
  anonymous visitors can also read the catalog.

An admin changes roles on the Users page. With single sign-on, an admin can map directory groups to roles; the role
is refreshed from the directory on every login. See [Self-hosting](../03-self-hosting.md).

## Sessions, tokens and roles

- The browser session lasts 30 days by default and is extended while you use it.
- API tokens (`sf_…`) act as their owner, with the owner's role. A viewer's token cannot publish.
- A token with the MCP option works only for agents: apart from `GET /api/v1/me` and `GET /api/v1/health`, the REST
  API refuses it with `403 mcp_token_forbidden`. Use a regular token for the CLI.
- Tokens are created only in a browser session; a token cannot create other tokens.
- More than ten failed logins for one user name in fifteen minutes return 429. A disabled user gets 423 on login,
  and their sessions and tokens stop working.

## Rights that do not come from the role

Some rights depend on your relation to an artifact or a team, not only on your role:

| Right | Who has it |
|---|---|
| Publish a new version of an existing artifact | its owner and maintainers; reviewers and admins as an audited override |
| Transfer ownership, add or remove maintainers | the owner and admins |
| Edit metadata and labels, move a version between channels | whoever may publish versions of the artifact |
| See a team artifact | members of its team, its owner and maintainers, reviewers and admins |
| Manage team members, set availability for a team | the team's lead and admins |

See [Teams, visibility and ownership](../11-teams-visibility-ownership.md).

## Before you start

1. Sign in on the registry's login page with a password account, a single sign-on button or a directory account,
   whichever your administrator set up.
2. Open **My workspace** (`/me`) from the user menu. It shows your artifacts, agents, token counts, recent activity
   and, for reviewers and admins, the review queue.
3. If you will use the command line, install the CLI from your registry (Node.js 24 or newer). The Home page shows
   the exact command:

   ```bash
   npm i -g <registry>/downloads/skillforge-cli.tgz
   skillforge --version
   ```

4. Press `?` on any page for its help, or open the help center at `/help`.

## See also

- [User guide](../02-user-guide.md) for a tour of the product.
- [Agent runtimes](../agents/README.md) for installing into each agent.
- [Glossary](../glossary.md) for the terms used here.
- In-app help: `getting-started/roles`, `getting-started/overview`.
