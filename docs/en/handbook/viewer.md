# Viewer

A viewer reads the registry and brings approved artifacts to their own agents. This chapter lists what a viewer can
do and walks through the daily tasks: finding an artifact, installing it, connecting an agent over MCP, keeping an
agent snapshot and reporting whether a skill helped. Every other role can do all of this too.

## On this page

- [What a viewer can do](#what-a-viewer-can-do)
- [Find an artifact](#find-an-artifact)
- [Read an artifact page](#read-an-artifact-page)
- [Install into your agent](#install-into-your-agent)
- [Install a method pack](#install-a-method-pack)
- [Connect your agent over MCP](#connect-your-agent-over-mcp)
- [Keep an agent snapshot](#keep-an-agent-snapshot)
- [Report usage and session facts](#report-usage-and-session-facts)
- [Discuss and follow artifacts](#discuss-and-follow-artifacts)
- [Look after your account](#look-after-your-account)
- [See also](#see-also)

## What a viewer can do

| You can | You cannot |
|---|---|
| browse Home, Catalog, artifact pages and the Metrics board | publish or import (`POST /api/v1/artifacts` returns 403) |
| install active artifacts with the CLI, the marketplace or a pack | change lifecycle status |
| create and revoke your own API tokens, including MCP tokens | publish from an agent snapshot |
| keep agent snapshots and compare them with the registry | manage users or teams |
| report usage, upload session facts, comment, watch artifacts | see team artifacts of teams you are not in |

A viewer who is a member of a team also sees that team's artifacts.

## Find an artifact

1. Open **Home** (`/`). Type counts link to the catalog filtered by type; **Recently published** shows the newest
   cards.
2. Open **Catalog** (`/artifacts`) and narrow the list: type tabs, search, status, team, owner, label and **Agent**.
   Filters stay in the URL, so a link restores the same view.
3. Press Ctrl+K (⌘+K on a Mac) on any page to jump to the catalog search.
4. Pick your agent in the **Agent** filter to keep only what installs into it.
5. Open **Metrics** (`/metrics`) to compare artifacts by Transfer Rate, Ablation Score, sessions and token estimate.
   Signed in, you can export the filtered rows as CSV or JSON. Numbers are signals, not proofs.

From the terminal:

```bash
skillforge search pdf
skillforge list --label payments
skillforge info skill/pdf-tools
skillforge suggest
```

`skillforge suggest` proposes active skills for the current project from local signals such as `package.json`; the
first run asks for your consent and sends no signals to the registry.

## Read an artifact page

The artifact page (`/artifacts/<type>/<name>`) has tabs that keep their state in the URL:

| Tab | What to look at |
|---|---|
| Overview | the rendered main file, metrics, metadata, provenance, and the **Agents** section |
| Files | the file tree; markdown renders, and **Source** shows the exact bytes |
| Versions | every version with digest and channel; **Compare versions** shows a diff |
| Quality | grade, security scan verdict, context cost, hook risk table, duplicates |
| Evidence | evidence links, usage, Transfer Rate |
| Install | the command for your agent, marketplace commands, downloads |
| Audit, Comments | history of the artifact and its discussion |

Check the status chip first. Only `active` artifacts get install commands; `candidate` means nobody has approved it
yet. A **Replaced** chip points to the successor.

## Install into your agent

1. On **API tokens** (`/me/tokens`), create a token named for its job, without the MCP option. Copy the secret at
   once: it is shown only once.
2. Sign in with the CLI:

   ```bash
   skillforge login --url <registry> --token <sf_token>
   ```

3. On the artifact's **Install** tab, pick your agent and copy the command, or type it:

   ```bash
   skillforge install skill/pdf-tools --runtime codex
   skillforge sync --runtime codex --status active
   skillforge outdated --runtime codex
   ```

4. In Claude Code you can use the plugin marketplace instead. Run the command from the Home page once, then the
   `/plugin install` command from the Install tab:

   ```text
   /plugin marketplace add <registry>/marketplace.json
   /plugin install pdf-tools@skillforge
   ```

The CLI checks every file against the registry's signature before writing, refuses a version whose security scan
failed unless you pass `--allow-risky`, and never downgrades unless you pass `--allow-downgrade`. `sync` also installs
what your teams require or install by default. See [Agent runtimes](../agents/README.md).

## Install a method pack

1. Open **Packs** (`/packs`) from the user menu.
2. Open a pack and copy the command for your role:

   ```bash
   skillforge pack install team-method@1.0.0 --role developer
   ```

Pack versions pin exact artifact versions; `sync` does not move them, a newer pack version does.

## Connect your agent over MCP

1. On `/me/tokens`, create a token and select **Allow agents to load active skills via MCP**. Add MCP tags to limit
   what the agent sees, or leave them empty for every active artifact.
2. Under the secret, pick your client and copy the HTTP or stdio command, for example:

   ```bash
   claude mcp add skillforge -- skillforge mcp
   ```

3. Revoke the token on the same page when a laptop is lost or a job ends.

Treat skill text as untrusted input for the agent. See [MCP](../13-mcp.md).

## Keep an agent snapshot

A snapshot compares a local agent folder with the registry. Only files that make up artifacts leave your machine.

```bash
skillforge agent scan .claude --name laptop
skillforge agent scan --runtime codex --name laptop-codex --mcp
skillforge agent status --name laptop
```

Or open **My agents** (`/me/agents`), choose **Add agent**, enter a name, pick a runtime and a folder. On the agent
page, filter by status: copy the install command for `outdated` and `registry_only` items, and fix what the MCP
section marks (pin the package, replace a literal secret with a reference such as `${VAR}`), then scan again. A
viewer cannot publish from a snapshot; ask a contributor. See [Agents and inventory](../12-agents-and-inventory.md).

## Report usage and session facts

Usage reports feed the Transfer Rate (helped / uses) on the Evidence tab:

```bash
skillforge report-usage skill/pdf-tools --uses 10 --helped 7 --report-id run-42
```

Session metrics count skill calls in your local Claude Code sessions and upload only a few fields per call:

```bash
skillforge sessions import --dry-run --json
skillforge sessions import --harness claude-code
```

Remove your facts in **My workspace** under **My sessions**. See [Session metrics](../16-session-metrics.md).

## Discuss and follow artifacts

- On the **Comments** tab, post plain text, mention `@username`, and reply in a thread. Never paste secrets.
- Use **Watch** on the artifact header to get new versions, status changes and comments. Commenting watches
  automatically; `skillforge watch skill/pdf-tools --off` stops it.
- The bell in the header counts unread notifications; `/me/notifications` lists them and lets you turn off every
  kind except mentions.

## Look after your account

- Change your password from the user menu (at least eight characters). Single sign-on accounts have no SkillForge
  password.
- On `/me/tokens`, watch `last_used_at` and revoke tokens you no longer need.
- If the administrator turned on the help assistant, open the **Assistant** tab in the help center. It only explains;
  it never changes anything.

## See also

- [Handbook by role](README.md) for the other roles.
- [Contributor](contributor.md) for publishing.
- [Versions and channels](../10-versions-and-channels.md) for version specs and pins.
- In-app help: `pages/home`, `pages/catalog`, `pages/artifact`, `pages/tokens`, `pages/me-agents`.
