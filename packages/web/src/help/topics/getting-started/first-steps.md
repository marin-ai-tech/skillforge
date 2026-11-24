---
title: First steps
summary: The whole path from starting SkillForge to checking that it works with your agents, in eleven steps, each with a sign that it is done.
section: start
learn:
  - How to start SkillForge and add people and agents
  - How to load artifacts and connect agents over MCP
  - How to run several agents and sessions on one machine
  - How teams and method packs bring artifacts to people
  - How to check the whole setup at the end
related: getting-started/overview, getting-started/self-hosting, getting-started/cli, getting-started/mcp, getting-started/teams, pages/packs
---

Follow the steps in order. Each one says what to do, how to tell it is done, and where the details are. The last step collects every sign of success into one checklist.

## 1. Start SkillForge

Unpack a release archive (or run the Docker image) and start the server with a data directory of its own, for example `SKILLFORGE_DATA_DIR=/srv/skillforge/data`. On the first start the server creates `admin` and, if you did not set `SKILLFORGE_ADMIN_PASSWORD`, writes the password to `initial-admin-password.txt` in the data directory.

**Done when** `GET /api/v1/health` answers `200` and you can sign in as `admin`. Details: [Self-hosting](getting-started/self-hosting).

## 2. Add people and agents

On **Users** (`/admin/users`) add a user per person. Give an agent its own user when you want its numbers apart from a person's: a viewer is enough for an agent that only reads and reports.

**Done when** each new user signs in and sees their role in **My workspace**. Details: [Roles](getting-started/roles).

## 3. Load artifacts

On the **First-run guide** (`/start`) install the default starter packs, or publish your own on **Publish** (`/publish`) or with `skillforge publish <dir>`. Every version gets a security verdict; a version with `fail` needs a reviewer to clear the findings before it can become active. A reviewer then makes it active.

**Done when** the artifact is `active` in the catalog. Details: [Uploading artifacts](getting-started/upload-artifacts).

## 4. Connect an agent over MCP

On **API tokens** (`/me/tokens`) create a token with MCP consent and copy the connection hint for your agent: the hint keeps the token in an environment variable, not in the agent's config file. On Windows, Claude Code may need `cmd /c skillforge mcp` instead of `skillforge mcp` for the stdio bridge; check with `claude mcp list`.

**Done when** the agent's `search_artifacts` call returns your artifacts. Details: [MCP access for agents](getting-started/mcp).

## 5. Connect several agents

Give each agent its own token (and its own user, if its numbers should be apart). Send a snapshot from each agent with `skillforge agent scan --mcp`: it lists the agent's skills and MCP servers, names and versions only.

**Done when** every agent is listed on **Agents** with its skills and MCP servers. Details: [Agents](getting-started/agents).

## 6. Several sessions of one agent

Each account is a CLI profile: `skillforge login --profile station --url <base> --token <token>`. A project chooses its profile with a `.skillforge/profile` file holding the profile name, or a session sets `SKILLFORGE_PROFILE`. The MCP bridge uses the same profile, and an explicit profile is stronger than `SKILLFORGE_TOKEN`, so one session no longer takes over another.

**Done when** `skillforge profile list` shows each profile and `skillforge whoami` in each project names the right user. Details: [CLI](getting-started/cli).

## 7. Skills and MCP servers in a session

Run `skillforge sync` to install what is required for you. An approved MCP server runs at its approved version; the registry tells its owner when the package source has a newer release or when people run another version. Agents report usage with the MCP tool `record_usage`, and `skillforge sessions import` sends usage facts from local session logs.

**Done when** the artifact page shows your usage and sessions. Details: [Session metrics](getting-started/session-metrics).

## 8. Check My workspace

Open **My workspace** (`/me`): your artifacts, agents, tokens, session facts and **My usage reports** — what you and your agents reported, per artifact. With tokens but no snapshot and no session facts, the page shows the commands that send them.

**Done when** your usage reports and your agent are on the page. Details: [My workspace](pages/me).

## 9. A development team

On **Teams** (`/teams`) create the team, add members and set artifacts as `default` or `required` for it. Post a news item for the team when something changes. A member sees the assignments in `skillforge sync` and on the artifact pages.

**Done when** a member's `GET /api/v1/me/assignments` lists the required artifact. Details: [Teams](getting-started/teams).

## 10. A team method pack

A method pack is how the team works: roles with artifacts at pinned versions. Create it with **New pack** on **Team method packs** (`/packs`) or with `skillforge pack publish pack.json` (`--dry-run` only checks). The pack page shows its versions, who published them and the difference between two versions; its owner publishes the next version there after **Check**. A member installs a role with `skillforge pack install <name> --role <role>`; `sync` keeps the pinned versions.

**Done when** the role is installed and the lock file pins its versions. Details: [Method packs](pages/packs).

## 11. Check everything

- [ ] `GET /api/v1/health` answers `200`, `admin` signs in.
- [ ] Every person and agent signs in with their own user.
- [ ] Your artifacts are `active`; none with an uncleared `fail` is active.
- [ ] `search_artifacts` over MCP returns them.
- [ ] Every agent is on **Agents** (`/me/agents`) with its skills and MCP servers.
- [ ] `skillforge whoami` names the right user in each project.
- [ ] Usage and sessions show on the artifact pages.
- [ ] **My usage reports** lists what your agents reported.
- [ ] Team members see their required artifacts.
- [ ] The pack role installs at pinned versions.
