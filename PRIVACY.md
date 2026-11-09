# Privacy

This policy covers SkillForge: the registry server with its web interface, the `skillforge`
command-line tool and the files it installs into agent folders. It is published by
marin-ai technologies (https://github.com/marin-ai-tech).

## What we collect

Nothing. SkillForge is self-hosted: the server runs on your infrastructure and the CLI talks
only to the registry you configure. It has no telemetry, no account of ours and no server of
ours; marin-ai technologies receives no data from it.

## What the registry stores

The server keeps its data in its data directory (`SKILLFORGE_DATA_DIR`): the SQLite database,
the content-addressed blobs of published versions, backups, logs and the signing key. This
includes user accounts, published artifacts and their metadata, comments, the audit log,
usage reports sent by agents and CLIs, and the agent snapshots people upload. The data stays
where you run the server and follows your retention; an admin removes artifacts and their
data with purge.

## What the CLI sends to your registry

Only what a command needs. Notably:

- `skillforge agent scan` sends only the files that make up artifacts; other files of the
  agent folder (for example `settings.local.json`, `auth.json`, `.env`) stay on the machine.
- `skillforge agent scan --mcp`, with that flag as consent for one run, reads the agent's MCP
  server configs and sends names, transport, package and pinned version, the remote origin and
  the names of variables and headers, never their values.
- `skillforge suggest` and `skillforge harvest` work on the local machine.

## What the server can contact, and only if you configure it

By default the server contacts nothing outside itself. An admin can configure:

- an LLM provider (OpenAI-compatible API) for the help assistant and skill validation; the
  key comes from the environment and is sent only to allowed origins; requests carry help
  topics and the question, or the content of the skill being checked;
- OIDC or LDAP identity providers for sign-in;
- git repositories and mirrors to import artifacts from;
- the GitHub API (with `SKILLFORGE_GITHUB_TOKEN`) for rollouts through pull requests and for
  harvesting rules from past reviews;
- external reviewers of the review-assistant plugin, which receive the artifact files under
  review;
- server plugins, which run with the permissions their manifest declares.

Each of these services handles the data under its own terms.

## Coding agents

The coding agents you install artifacts into (Claude Code, Codex, Cursor and others) and that
connect to the registry over MCP read that content under their own terms. SkillForge does not
send anything to an agent's provider itself.

## Contact

Questions about this policy: https://github.com/marin-ai-tech (open an issue in the SkillForge
repository).
