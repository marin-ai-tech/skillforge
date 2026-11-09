---
title: Uploading artifacts
summary: Every way to get skills and other artifacts into the registry, from GitHub, your agent's folder, a zip or a single package. Start here to pick a route and see what happens after the upload.
section: publishing
learn:
  - Which route fits where your files are
  - How to import from GitHub or another git host
  - How to upload from your agent's folder
  - What happens after the upload and who makes it active
related: pages/import, pages/publish, getting-started/agents, getting-started/cli, getting-started/ownership, getting-started/lifecycle
---

Uploading needs the **contributor** role or higher. The same validation and the same hook publish gate apply on every route, so pick the one that suits where your files are.

| Where the files are | Route | Where |
|---|---|---|
| GitHub or another git host | Import, source `git` | `/import` |
| A zip archive | Import, source `zip` | `/import` |
| A folder on your computer, many packages | Import, source `folder` | `/import` |
| Your agent's folder, to see what is new | Agent snapshot | `skillforge agent scan`, then `skillforge agent publish` |
| One package, or a CI job | Publish | `/publish` or `skillforge publish` |

## From GitHub or another git host

There is no CLI command for Import; it runs on the Import page or through its API. Note that `skillforge sessions import` is something else: it uploads usage facts, not artifacts.

1. Open Import from the user menu and choose the source `git`.
2. Enter the repository address. `https://`, `ssh://` and `git@host:path` are accepted.
3. Optionally set a branch or tag and a folder inside the repository, such as `.claude/skills`. A commit hash does not work as a ref.
4. Click Preview. The server makes a shallow clone and lists the packages it found, with a status for each.
5. Select the rows marked Ready or Warnings and click Import selected. Skip conflicts is on by default, so importing the same source again does not create duplicates.

The server itself does the cloning, with its own git setup. It needs git, network access to the host and, for a private repository, its own access to that repository. The clone has a two-minute limit, and an import may hold at most 5000 files and 64 MB.

## From your agent's folder

An agent snapshot compares your folder with the registry and shows what only you have. Install the CLI from your registry, create a token on the Tokens page without the MCP option, and sign in:

```bash
npm i -g <registry>/downloads/skillforge-cli.tgz
skillforge login --url <registry> --token <sf_token>
```

Upload a snapshot of the folder, then publish what you need. Items marked `local_only` exist only with you, and `modified` means your copy differs from every published version:

```bash
skillforge agent scan .claude --name laptop
skillforge agent publish skill/my-skill --name laptop --version 0.1.0
```

For another agent, add `--runtime` to the scan, for example `--runtime codex`. The Publish button on the agent's page in My workspace does the same as the second command. To upload the whole folder at once without comparing, use Import with the source `folder`.

## One package

Use the Publish page, or point the CLI at a package folder or a single markdown file. Check it first with `skillforge validate`; leave out `--version` to get a version automatically.

```bash
skillforge validate .claude/skills/my-skill --type skill
skillforge publish .claude/skills/my-skill --type skill --version 0.1.0 --changelog "First version"
```

A single publish may hold at most 1000 files and 32 MiB in total, and 16 MiB per file.

## After the upload

A new version lands as **candidate**. Agents do not see it through MCP or the marketplace yet: only **active** artifacts are offered there. A reviewer or admin promotes it on the Lifecycle board. The author of the latest version cannot promote it themselves; an admin can, with a reason, and the audit marks it.

The first publish of a name makes you its owner. After that, only the owner, co-authors, reviewers and admins can add versions.

> [!NOTE]
> MCP cannot upload: its tools only search, read and record usage. A token with the MCP option works only on `POST /mcp`, so the CLI gets `mcp_token_forbidden` with it. Use a separate token for uploads.

## Common errors

- `digest_exists`: the same content is already published. Nothing is needed, or change the content.
- `version_exists`: that version number is taken. Raise the version or leave it out.
- `not_owner`: the artifact belongs to someone else. Ask the owner to add you as a co-author.
- `publish_blocked`: a subscribed hook stopped the publish. Read the reason in the response; `hook unavailable:` means an admin must repair or disable the subscription.
- `mcp_token_forbidden`: the token has the MCP option. Create a token without it.
- `import_url_not_allowed`: the address is not one of the accepted forms. Use `https://`, `ssh://` or `git@host:path`.
- `import_git_disabled`: git import is off on this server. Ask the operator about `SKILLFORGE_IMPORT_GIT`, or use `zip`.
- `import_too_large`: over 5000 files or 64 MB. Set a folder inside the repository, or split the import.
