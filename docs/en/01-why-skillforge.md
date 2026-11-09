# Why SkillForge

Coding agents work from text: skills, slash commands, subagents, hooks, rules, plugins and the MCP servers they
connect to. In a team these files multiply fast, and most of them live where nobody else can see them. SkillForge is a
registry for them on your own server: one place to publish, review, version and install what agents run on.

## The problem

- **Scattered copies.** A useful skill is pasted from a chat into one person's `~/.claude`, then copied and edited by
  three others. Nobody knows which copy is current, and fixes do not travel.
- **No review.** An agent follows the text it is given. A skill or hook from an unknown source can tell it to read
  secrets, call the network or run commands. Most teams have no step where a second person looks before a file starts
  steering agents.
- **No history.** When an agent starts behaving differently, there is no record of what changed in its instructions,
  who changed it, or how to go back.
- **Rot.** Artifacts that nobody uses any more keep loading into every session and cost context. Nothing tells you
  what is safe to remove.
- **Different agents, different formats.** Claude Code, Codex, Cursor, OpenCode and the rest keep commands and agents
  in different folders and formats. A team that mixes tools maintains the same instruction several times.
- **Unseen MCP servers.** Developers connect MCP servers on their machines; the organization does not know which
  servers its agents talk to.

## How SkillForge answers

| Problem | What SkillForge does |
|---|---|
| Scattered copies | Every artifact has one name, an owner, versions and a changelog; `skillforge sync` keeps machines on the same versions through a lock file |
| No review | New artifacts start as candidates; a reviewer promotes them after validation, the quality score, the security scan and evidence; an author cannot promote their own work |
| No history | Versions are immutable and signed; versions can be compared line by line and rolled back; an audit log records every decision |
| Rot | Usage reports, quality and age move artifacts to aging and zombie; the lifecycle board lists what to retire today |
| Different formats | The CLI translates an artifact into each agent's folders and format on install, and back on scan |
| Unseen MCP servers | MCP servers are artifacts with an origin policy; `skillforge agent scan --mcp` and the inventory show servers that are not in the registry |

## What it is not

- **Not a public marketplace.** SkillForge is self-hosted for one organization. It can mirror external catalogs, but
  what your agents install is decided by your reviewers.
- **Not an agent.** It does not run your agents or change their models. It manages the files they read and gives them
  an MCP endpoint to search the registry.
- **Not a sandbox.** Review, scans and policies lower the risk of a harmful artifact; they do not make an agent safe to
  run with broad permissions.

## What it takes to run

One Node.js 24 process with an SQLite database and a folder of blobs, or the Docker image. Sign-in by password, OIDC or
LDAP. No telemetry and no outside service unless you configure one (see [PRIVACY.md](../../PRIVACY.md)).

## See also

- [User guide](02-user-guide.md) — the everyday flows.
- [Self-hosting](03-self-hosting.md) — install and configure the registry.
- [Lifecycle and review](07-lifecycle-and-review.md) — how an artifact becomes trusted and how it is retired.
- [Agents](agents/README.md) — what each supported agent gets.
