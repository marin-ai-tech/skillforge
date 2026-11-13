# Admin

An admin runs the registry for the organisation: accounts and teams, the policies that decide what may be published
and imported, the reports and inventory that show what people actually use, and backups and incident response. This
chapter lists the admin pages and walks through the first run and the recurring tasks. An admin can also do
everything a [reviewer](reviewer.md) can.

## On this page

- [What an admin can do](#what-an-admin-can-do)
- [First run](#first-run)
- [Manage users](#manage-users)
- [Manage teams and access](#manage-teams-and-access)
- [Set the policies](#set-the-policies)
- [See what people use](#see-what-people-use)
- [Bring artifacts to repositories and agents](#bring-artifacts-to-repositories-and-agents)
- [Extend the registry](#extend-the-registry)
- [Backups, diagnostics and incidents](#backups-diagnostics-and-incidents)
- [See also](#see-also)

## What an admin can do

The admin pages are in the user menu:

| Page | Route | For |
|---|---|---|
| Users | `/admin/users` | accounts, roles, passwords, disabling, artifacts without an owner |
| Teams | `/teams` | creating and deleting teams |
| Lifecycle policy | `/admin/lifecycle` | the lifecycle sweep, security policy, MCP policy, company quality rules |
| Agents admin | `/admin/agents` | server agents under `SKILLFORGE_AGENT_ROOTS` |
| Inventory | `/admin/inventory` | what stands on people's machines, including MCP servers |
| Report | `/admin/report` | use by team and artifact, unused artifacts |
| Audit log | `/admin/audit` | who did what and when, with NDJSON export |
| Rollout | `/admin/rollout` | pull requests that add artifacts to repositories |
| Harvest | `/admin/harvest` | rules collected from pull request review comments |
| Plugins | `/admin/plugins` | server plugins: status, enablement, configuration |
| Assistant | `/admin/assistant` | the language model for the help assistant and skill checks |
| Backups | `/admin/backups` | data archives |

Admins also install starter packs, purge leaked content, transfer the ownership of any artifact and set the
company layer of edits over an artifact.

## First run

1. Sign in as the seeded user `admin` with the initial password, then change it from the user menu. The
   `initial-admin-password.txt` file is deleted on the first successful change.
2. Open the **First-run guide** (`/start`). Install one or both starter packs: CodeAlive (twelve skills) and ECC
   essentials (three skills), all MIT. Their skills arrive as `candidate` with provenance `import`; installing again
   creates nothing new.
3. Review the candidates and choose **Promote all candidates**, with an optional reason, or promote them one by one.
4. Copy the marketplace connect command from the same page and share the CLI install command from Home.
5. Run `skillforge doctor` for a health checklist.

Single sign-on (OpenID Connect, LDAP or Active Directory) is configured with environment variables by whoever runs
the server. See [Self-hosting](../03-self-hosting.md).

## Manage users

On **Users administration**:

1. **Create** a password user with a user name, a password of at least eight characters, a role and an optional
   display name. Grant `contributor` to authors and `reviewer` to people who endorse candidates.
2. **Change role**, **reset password** (password accounts only; single sign-on accounts have none), or **disable**
   an account after offboarding. Its sessions and tokens stop working at once.
3. The last active admin cannot be demoted or disabled (`409 last_admin`).
4. Under **Artifacts without an owner**, hand over artifacts of disabled people and of owners that no longer exist.
   Each row suggests a co-author; **Hand over** records the previous owner in the audit log.

## Manage teams and access

```bash
skillforge teams create payments --lead <user>
skillforge teams add payments <user> --role member
skillforge teams show payments
```

- Only an admin creates or deletes a team. A team still referenced by an artifact cannot be deleted
  (`team_in_use`). Leads manage members afterwards; the last lead cannot be removed.
- **Visibility**: an artifact is `org` (everyone who can read the registry) or `team` (members, owner, maintainers,
  reviewers and admins). Change it in the scope panel or with
  `skillforge scope skill/pdf-tools --visibility team --team payments`.
- **Availability for teams**, on the artifact page: not available, available, installed by default, or required.
  `skillforge sync` follows it. Availability guides installation; it does not hide anything.

See [Teams, visibility and ownership](../11-teams-visibility-ownership.md).

## Set the policies

On **Lifecycle policy** (`/admin/lifecycle`):

- **Sweep.** Read the thresholds, choose **Dry run**, check the plan rows, then **Run sweep** and confirm. A real
  sweep changes the status of every artifact in its plan. The thresholds are `SKILLFORGE_*` environment variables.
- **Security policy** (`security-policy`): whether a failed content scan blocks publishing, import and agent uploads
  (`E_SECURITY_BLOCKED`).
- **MCP policy** (`mcp-policy`): which package types (`npm`, `pypi`, `oci`) an MCP server may run from and which
  remote origins are allowed. Without any origin, remote MCP servers are not published (`E_MCP_POLICY`).
- **Company quality rules**: a threshold from 0 to 100, a mode (off, warn, block), check weights and your own
  criteria such as a required section, a required file or a forbidden phrase. The lead of a team can add rules for
  the team's artifacts, but only stricter ones.

On **Import**, as an admin:

- **Import source policy**: allowed git addresses, whether zip and folder uploads are allowed, and the minimum
  release age. A commit younger than that age is quarantined; you can import it anyway with a reason for the audit
  log.
- **Upstream mirrors**: git sources checked daily or with **Check now**. New packages arrive as candidates, changed
  ones as a new version in `beta`.

See [Quality and security](../09-quality-and-security.md) and [Publishing and import](../06-publishing-and-import.md).

## See what people use

1. **Inventory** sums up everyone's agent snapshots: copies in sync, outdated, modified and not in the registry.
   Artifacts that circulate without being published, with one variant, are good candidates to publish. When people
   scan with `--mcp`, the MCP section lists their servers, flags unpinned packages and literal secrets, and names
   shadow servers that no registry `mcp-server` declares. Only names and counts are shown.
2. **Report** shows sessions, people and a context token estimate by team and by artifact for 7, 30, 90 or 365 days,
   and the active artifacts nobody used. Retire what nobody needs through the usual lifecycle.
3. **Audit log** merges artifact events with system events such as `user_update`, `security_policy_change` and
   `mirror_create`. Filter by action or person, or download NDJSON. For a SIEM, pull `GET /api/v1/admin/audit` with
   an admin token and pass `next` back as `after`.

See [Agents and inventory](../12-agents-and-inventory.md) and [Metrics dashboard](../15-metrics-dashboard.md).

## Bring artifacts to repositories and agents

- **Rollout** opens one pull request per repository with exactly what `skillforge install --into .claude` would
  write, including the lock file. It needs `SKILLFORGE_GITHUB_TOKEN` in the server environment. After merging, the
  repository stays current with `skillforge sync --into .claude`.
- **Harvest** collects rules that recur in review comments of a GitHub repository and publishes them as a candidate
  skill with provenance `harvest`.
- **Agents admin** registers server agents whose folders live on the SkillForge host inside
  `SKILLFORGE_AGENT_ROOTS`; paths that escape the roots fail with `path_outside_roots`.
- **Company layer of edits**: `PUT /api/v1/artifacts/<type>/<name>/overlays/company` stores operations that
  `install` and `sync` apply over the published files for everyone.

## Extend the registry

- **Plugins**: see each server plugin's status (`loaded`, `error`, `disabled`), toggle it (takes effect after a
  restart) and edit its JSON configuration (takes effect at once). Plugin code runs with the server's privileges.
- **Assistant**: enter an OpenAI-compatible API address and a model, test the connection and turn the help assistant
  on. The API key is never entered here: the server operator sets `SKILLFORGE_LLM_API_KEY`, and it is sent only to
  origins listed in `SKILLFORGE_LLM_KEY_ORIGINS`.

See [Plugins](../14-plugins.md).

## Backups, diagnostics and incidents

- **Backups**: choose **Create backup** before upgrades and risky imports, then download the archive and store it
  off the host. It holds the database snapshot, every blob and the release signing key, so keep it as a secret. To
  restore, stop the server and unpack into an empty data directory: `tar -xzf <name> -C <empty-data-dir>`.
- **Diagnostics**: `skillforge doctor --bundle --output diag.tar.gz` downloads a diagnostics bundle.
- **Leaked secret**: revoke the secret at its provider first, then purge. Never put the secret in the reason:

  ```bash
  skillforge purge skill/pdf-tools@1.2.0 --reason "leaked credential in references" --confirm skill/pdf-tools@1.2.0
  ```

  A purge is irreversible. Earlier backups may still hold the content; `--delete-backups` removes registry archives.

See [Backups and operations](../20-backups-and-operations.md) and [Metadata and purge](../19-metadata-and-purge.md).

## See also

- [Handbook by role](README.md) for the other roles.
- [Self-hosting](../03-self-hosting.md) for installation, configuration and upgrades.
- In-app help: `pages/users`, `pages/admin-lifecycle`, `pages/admin-inventory`, `pages/admin-backups`,
  `getting-started/purge`.
