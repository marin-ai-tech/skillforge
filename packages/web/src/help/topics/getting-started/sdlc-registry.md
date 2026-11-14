---
title: sdlc team registry plugin
summary: The built-in sdlc-registry plugin lets sdlc read team roles, skills and rules straight from SkillForge over MCP, and turns sdlc process events into usage reports.
section: automation
learn:
  - What the sdlc team registry asks for and where SkillForge finds it
  - How to turn the plugin on and point sdlc at it
  - Why process events need an integration token
related: getting-started/plugins, getting-started/mcp, actions/tokens/mcp
---

sdlc keeps a team registry (`team.registry` in `sdlc.yaml`): an MCP server that answers `list_roles`, `get_role`, `list_skills`, `get_skill`, `list_rules` and `get_rule`, and receives process events through `report_outcome`. The built-in `sdlc-registry` plugin answers these tools on SkillForge's own `/mcp`, so sdlc needs no adapter.

## Where the answers come from

- **Roles** are agents in the registry tagged `sdlc-role`. The role's front matter gives `title`, `stages`, `tools`, `readonly` and `skills`; the body after the front matter is the role text. `get_role` also returns the marker `skillforge-source: agent/<id>@<version>` that sdlc writes into the role agents it builds, so `skillforge agent scan` links them back to the registry ([Agents](getting-started/agents)).
- **Skills** are active skills; `get_skill` returns every file of the version in one call, with paths inside the skill folder and sdlc's checksum. A skill with a binary file is refused, because sdlc takes text files only.
- **Rules** are active rules with their `tags`, `paths` and body.
- Every answer is read as the calling token: a team artifact the token cannot see does not exist for sdlc either, and MCP tags on the token narrow the lists.

## Turning it on

The plugin ships with SkillForge and is off until an administrator turns it on on `/admin/plugins` (a restart applies it). Then point `team.registry` in `sdlc.yaml` at `/mcp` of this SkillForge with an MCP token.

## Process events

`report_outcome` is a tool for integrations: only a token created with **For an integration, not an agent** sees it, so an agent cannot report events on its own. An approved or passed stage (`gate.<stage>.approved`, `verify.passed`) records one use that helped for each skill of the roles that work on that stage; a rejected, reworked or failed one records a use that did not help. These reports have the basis `assigned`: they are shown separately and do not change Transfer Rate, because an event does not say which skills the agent really loaded. An event without a known outcome reports nothing. Repeating the same event is safe.

> [!NOTE]
> Give sdlc two tokens if it both reads the registry and sends events: an ordinary MCP token for the agents and an integration token for the event sender.
