# MCP

SkillForge meets the Model Context Protocol (MCP) in two ways, and this page covers both. First, SkillForge
is itself an MCP server: a coding agent connects to it and reads approved artifacts without installing files.
Second, the registry describes the other MCP servers your company approves, as artifacts of type
`mcp-server`, governed by an MCP policy and cross-checked against what people actually run.

## Part 1. SkillForge as an MCP server for agents

### What an agent can do

The endpoint is `POST /mcp` (JSON-RPC 2.0, Streamable HTTP), also reachable through the `skillforge mcp`
stdio bridge. It offers five tools:

| Tool | What it does |
|---|---|
| `search_artifacts` | Search approved artifacts |
| `get_artifact` | Return an artifact with its files, each with `sha256` and a `binary` flag, and the version `digest` |
| `read_artifact_file` | Return one file: UTF-8 text up to 256 KiB, other files up to 4 MiB as base64 |
| `read_artifact_files` | Return all files of a version in one call, each as `read_artifact_file` does; files over 4 MiB or past 8 MiB in one answer are listed in `omitted` with a reason |
| `record_usage` | Report that an artifact was applied and whether it helped, optionally with `basis` `loaded` or `assigned` |

The first four only read. Through MCP an agent cannot publish, change a lifecycle status or install files;
that stays with `skillforge install` and the web interface.

### What an agent can see

- Only artifacts in status `active`, the same set as the Claude Code marketplace. Candidate, aging, retired
  and zombie artifacts answer as not found, so an agent cannot probe drafts.
- Only what the token's owner may see: team visibility applies (see
  [Teams, visibility and ownership](11-teams-visibility-ownership.md)).
- A path given to `read_artifact_file` must match a file path of the version exactly: no `..`, no
  backslashes, no normalisation tricks.
- Because `get_artifact` returns hashes and the digest, a client can verify what it received.

### Consent: MCP tokens and tags

MCP is off by default. To allow it, create an API token on `/me/tokens` and enable **Allow agents to load
active skills via MCP**.

- Optionally add up to ten kebab-case MCP tags (each at most 32 characters). The agent then sees only active
  artifacts that share at least one tag, matched against version tags or registry labels. Empty tags expose
  every active artifact you can see.
- Consent is fixed at creation. To change it, create a new token and revoke the old one.
- An MCP token works only for agents. On the REST API it may call just `GET /api/v1/me` and
  `GET /api/v1/health`; anything else returns `403 mcp_token_forbidden`, whatever your role. Use a regular
  token for `install`, `sync` and `publish`.
- Revoking the token cuts the agent's access at once.

Every MCP request must carry `Authorization: Bearer <token>`. Browser cookies are ignored, and requests with
an `Origin` header are rejected, so a web page cannot drive MCP on your behalf.

### Connecting a client

After you create the token, the tokens page shows a snippet for HTTP and one for the stdio bridge, with a
switch per client. The bridge takes the URL and token from `skillforge login` or flags; it exits with code 3
without a URL and 4 without a token.

```bash
# claude-code
claude mcp add --transport http skillforge <server>/mcp --header "Authorization: Bearer <token>"
claude mcp add skillforge -- skillforge mcp

# Codex: the token never appears on the command line
codex mcp add skillforge --url <server>/mcp --bearer-token-env-var SKILLFORGE_TOKEN
codex mcp add skillforge --env SKILLFORGE_URL=<server> -- skillforge mcp      # recommended

# OpenCode
opencode mcp add skillforge --url <server>/mcp --header "Authorization=Bearer <token>"
opencode mcp add skillforge -- skillforge mcp

# Qwen Code (user scope)
qwen mcp add -s user -t http -H "Authorization: Bearer <token>" skillforge <server>/mcp
qwen mcp add -s user skillforge skillforge mcp
```

For Codex over HTTP, set `SKILLFORGE_TOKEN=<token>` in the environment Codex starts from. Cursor is
configured in the user-level `~/.cursor/mcp.json`; the stdio entry keeps the token out of the file:

```json
{"mcpServers":{"skillforge":{"command":"skillforge","args":["mcp"]}}}
```

Do not commit a token: keep it out of a project-level `.cursor/mcp.json`. Any other MCP client connects over
HTTP to `<server>/mcp` with `Authorization: Bearer`. The per-runtime pages under [Agents](agents/README.md)
list the details.

### Content risk

Treat skill bodies as untrusted text inside the agent prompt: a careless or malicious skill can inject
instructions. Rely on the review gate before an artifact becomes `active` (see
[Lifecycle and review](07-lifecycle-and-review.md)), keep MCP tags narrow for sensitive teams and prefer
short-lived tokens for experiments.

## Part 2. MCP servers as artifacts

### The `mcp-server` type

An `mcp-server` artifact describes an approved MCP server that people configure in their agents. It holds two
files, stored under `mcp/<name>/`:

- `MCP.md` — frontmatter with `name`, `description` and optional `tags`, then documentation;
- `server.json` — how to run or reach the server, with the field names of the official MCP registry:
  `packages` (`registryType` `npm`, `pypi` or `oci`, `identifier`, `version`, `transport`,
  `environmentVariables`), `remotes` (`type`, `url`, `headers`) and an optional `tools` list.

A package example:

```json
{
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@modelcontextprotocol/server-github",
      "version": "2025.4.8",
      "runtimeHint": "npx",
      "transport": { "type": "stdio" },
      "environmentVariables": [
        { "name": "GITHUB_PERSONAL_ACCESS_TOKEN", "isRequired": true, "isSecret": true }
      ]
    }
  ],
  "tools": [{ "name": "search_issues", "description": "Search issues and pull requests" }]
}
```

A remote example, with the secret left as a variable each person fills in:

```json
{
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://mcp.sentry.dev/mcp",
      "headers": [
        { "name": "Authorization", "isSecret": true, "value": "Bearer {sentry_token}",
          "variables": { "sentry_token": { "isSecret": true } } }
      ]
    }
  ]
}
```

Publish it like any other artifact:

```bash
skillforge validate ./mcp/github-tools --type mcp-server
skillforge publish ./mcp/github-tools --type mcp-server
```

SkillForge does not install an MCP server into agents yet, and an MCP server is not a marketplace plugin:
people configure it in their agent by hand, as its artifact page shows.

### What publishing refuses

| Code | Refused when |
|---|---|
| `E_MCP_JSON_INVALID` | `server.json` is missing, not an object, or lists neither `packages` nor `remotes`; a package has no `identifier` |
| `E_MCP_UNPINNED` | an `npm` or `pypi` package has no exact version, or an `oci` image has no `@sha256:` digest (`latest`, ranges and tags are refused) |
| `E_MCP_SECRET_LITERAL` | a variable, header or argument that is secret, or looks secret, has a literal value or default |
| `E_MCP_SHELL` | `runtimeHint` is a shell, or an argument contains shell syntax such as `;`, `\|`, `&&` or `$(` |
| `E_MCP_TRANSPORT_UNKNOWN` | an unknown `registryType`, package transport (not `stdio`, `streamable-http`, `sse`) or remote type |
| `E_MCP_URL_INVALID` | a remote `url` that is not plain `https`, carries credentials or a key-like query parameter, or points to `localhost` |
| `E_MCP_POLICY` | the package type or remote origin is not allowed by the MCP policy |

Values made only of `{variables}`, optionally after `Bearer`, are references, not literals. Open a code in
in-app help (for example `codes/E_MCP_UNPINNED`) for causes and fixes.

### The MCP policy

An admin sets the policy in the **MCP servers policy** panel on the lifecycle policy page
(`/admin/lifecycle`), or with `GET` and `PUT /api/v1/admin/mcp-policy`:

- `registry_types` — which package types an MCP server may run from (`npm`, `pypi`, `oci`; all three by
  default);
- `remote_origins` — which remote origins are allowed, as `https://host[:port]` or `https://*.domain` (the
  wildcard matches subdomains only), at most 100. The list is empty by default, so remote servers cannot be
  published until an admin allows their origin.

```json
{ "registry_types": ["npm", "pypi", "oci"], "remote_origins": ["https://mcp.sentry.dev", "https://*.acme.example"] }
```

Every change is written to the audit log as `mcp_policy_change`. A version outside the policy is refused
with `E_MCP_POLICY`; the message names the field and the origin, never the path.

### The server card

On the artifact page, the Overview of an `mcp-server` shows the MCP server card:

- the package and version, or the remote address;
- variables and headers, marked secret or required;
- the tools it declares;
- whether this version matches the current MCP policy, with the reason when it does not;
- how many installs the inventory has seen, by how many people, and how many run this exact version.

The usage numbers are counts only. A package matches by its identifier whatever the launcher (`npx`, `bunx`,
`pnpm dlx`), a remote server by its origin.

## Shadow MCP servers

The MCP servers people actually run come from `skillforge agent scan --mcp`, which sends names, transport,
package and pinned version, remote origin and variable names, never values (see
[Agents and inventory](12-agents-and-inventory.md)). The organisation inventory lists every server it has
seen, with unpinned installs and literal secrets first, and names the `mcp-server` artifact that declares
the same package or origin. A server with no such artifact is a shadow server.

A practical loop for admins:

1. Ask people to scan with `--mcp`.
2. In the inventory, look for shadow servers with several installs and for literal secrets.
3. Describe the servers you approve as `mcp-server` artifacts, pinned and without secret values, and allow
   their remote origins in the policy.
4. Ask people to fix literal secrets on their machines (a reference such as `${VAR}`) and to pin versions,
   then scan again.

## See also

- [Artifact types](05-artifact-types.md) — every type, including `mcp-server` and the `plugin` type's
  optional `.mcp.json`.
- [Quality and security](09-quality-and-security.md) — the other publish checks.
- In-app help: `getting-started/mcp`, `getting-started/artifact-types`, `pages/tokens`,
  `pages/admin-inventory`, `pages/admin-lifecycle`, `pages/artifact`.
