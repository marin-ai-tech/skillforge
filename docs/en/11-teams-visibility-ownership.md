# Teams, visibility and ownership

This page explains who can see an artifact, who can change it and what each team gets installed. It covers
teams and their roles, the `org` and `team` visibility scopes, availability for teams, owners and co-authors,
and what happens to artifacts whose owner leaves. Read it before you create the first team or move an
artifact out of the shared catalog.

## Three separate questions

SkillForge keeps three settings apart, because they answer different questions:

| Setting | Question | Who changes it |
|---|---|---|
| Visibility (`org` or `team`) | Who can see the artifact at all? | admin, a qualified owner, or the lead of the current team |
| Availability for teams | What does each team get installed? | admin for any team, a lead for their own team |
| Owner and co-authors | Who may publish new versions? | the owner or an admin |

Availability guides installation; it never hides anything. To keep an artifact away from other teams, use
visibility.

## Teams

A team groups people who share private artifacts. It has a kebab-case name of at most 40 characters, an
optional display name and description, and members with the role `member` or `lead`. Anyone can be a team
member, including a user with the `viewer` role, so that they can see the team's artifacts.

| Action | Who |
|---|---|
| Create or delete a team | admin |
| Add or remove members, change a member's role | the team's lead, or an admin |
| See the member list | team members and admins (other signed-in users see the team without members) |

Rules the server enforces:

- A new team needs an initial lead, who must be an existing, enabled user. A duplicate name returns
  `team_exists`, an invalid one `name_invalid`.
- A team holds at most 500 members (`team_full`).
- The last lead cannot be removed (`last_lead`).
- A team cannot be deleted while any artifact still names it as its owner team (`team_in_use`).
- Membership changes apply on the next request: a removed member loses access immediately.

Manage teams on the **Teams** page (`/teams`, signed-in users only) or from the CLI:

```bash
skillforge teams list
skillforge teams show payments
skillforge teams create payments --lead alice      # admin only
skillforge teams add payments bob                  # role member by default
skillforge teams add payments carol --role lead
skillforge teams remove payments bob
```

## Visibility

Every artifact has a visibility of `org` (the default) or `team`, plus an optional owner team.

- `org` — visible to anyone who can read the registry, including anonymous visitors when public read
  (`SKILLFORGE_PUBLIC_READ`) is on.
- `team` — visible to members of the owner team, the owner and co-authors, and reviewers and admins.
  Anonymous visitors never see team artifacts.

| Actor | `org` artifact | `team` artifact |
|---|---|---|
| Anonymous | yes, if public read is on | never |
| Signed-in user outside the team | yes | no |
| Team member, owner or co-author | yes | yes |
| Reviewer or admin | yes | yes, for every team |

An invisible artifact is indistinguishable from a missing one. A direct link shows the normal not-found
page (HTTP 404 with the same body), and the artifact is left out of lists, facet counts, home counters, the
marketplace, the lifecycle board, duplicates, agent comparisons and MCP tools.

### Choosing the scope when you publish

The first publish sets the scope:

```bash
skillforge publish ./skills/refund-policy --visibility team --team payments
```

Filter the catalog by scope, team, owner or label:

```bash
skillforge list --visibility team --team payments
skillforge list --owner alice --label billing
```

### Changing the scope later

Use the scope panel on the artifact page or the CLI:

```bash
skillforge scope skill/refund-policy --visibility team --team payments --reason "internal only"
skillforge scope skill/refund-policy --visibility org
```

Who may change the scope: an admin; the owner, if they are a member of both the current and the target
team; or the lead of the current team. The web page asks for confirmation when you narrow (`org` to `team`)
or widen (`team` to `org`). Every change is written to the audit log as `scope_change`. MCP tokens cannot
change the scope.

### Known limits

- The Claude Code marketplace JSON served without authentication lists only `org` artifacts. Install team
  plugins with the CLI or with a token that can see them.
- Names are unique across the registry. Publishing a new artifact whose name is taken by a team artifact you
  cannot see returns `403 not_owner` without the owner's name. The fact that the name is taken stays visible.

## Registry labels

Labels are short kebab-case strings stored on the artifact itself, separate from the tags of a version.
Editing them does not create a new version. Each label is 1–32 characters, at most 20 per artifact. Labels
drive the catalog label filter, `skillforge list --label`, and MCP tag matching (see [MCP](13-mcp.md)).
They grant no access: an outsider still gets not-found for a team artifact, whatever its labels.

```bash
skillforge labels skill/refund-policy set billing,payments
```

Labels are edited by the same people who may publish a new version.

## Availability for teams

On the artifact page, **Availability for teams** sets one of four states for each team:

| State | Effect for team members |
|---|---|
| `unavailable` | `skillforge install` refuses it without `--force`; `sync` never installs it |
| `available` | the default; installed only when someone asks for it |
| `default` | installed by `skillforge sync` |
| `required` | installed by `sync`, kept by `sync --prune`, `uninstall` refuses without `--force` |

An admin changes the state for any team, a lead for their own team. Every change is audited as
`availability_set`. For a person in several teams the most permissive state wins: one team marking an
artifact `unavailable` does not block it for someone whose other team leaves it `available`. Only active
artifacts count.

```bash
skillforge sync                          # installs required and default artifacts as well
skillforge sync --prune                  # removes others, keeps required ones
skillforge uninstall skill/refund-policy --force   # remove a required artifact anyway
```

## Owners and co-authors

Every artifact has exactly one owner and zero or more co-authors (maintainers). The owner is separate from
the person who first published it, so a transfer keeps the history. Owner and co-author names appear on the
artifact page for anyone who can open it.

A new version of an existing artifact may be published by:

- the owner;
- a co-author;
- a reviewer or admin, which the server records as an audited `publish_override`.

The first publish of a new name makes the publisher the owner. Anyone else gets `403 not_owner`, and the CLI
names the owner. Use the override for urgent fixes; for routine work, ask the owner to add you as a
co-author.

### Managing ownership

The ownership panel on the artifact page is shown only to the current owner and to admins. From it you can:

- transfer ownership, with a required reason, confirmed in a dialog;
- add a co-author, who must be an enabled user with the `contributor` role or higher and not the owner;
- remove a co-author.

Reviewers can publish with the override but cannot manage ownership. MCP tokens are refused on ownership
routes (`mcp_token_forbidden`).

If a co-author's role is later lowered to `viewer`, their name stays on the list but they cannot publish.
Raising the role again restores their rights without adding them again.

Artifacts created while the server ran in local auth mode belong to the user `local`. After switching to
password or single sign-on, only an admin can transfer them.

## Artifacts without an owner

When an admin disables a person who owns artifacts, every active admin gets a notification. The Users page
then lists those artifacts under **Artifacts without an owner**, together with artifacts whose owner no
longer exists. Each row suggests the first active co-author; **Hand over** makes the chosen person the owner
and records the previous owner in the audit log. Retired and purged artifacts are not listed. Turning the
person back on removes their artifacts from the list.

## See also

- [Lifecycle and review](07-lifecycle-and-review.md) — statuses and who moves artifacts between them.
- [Publishing and import](06-publishing-and-import.md) — publish flags, including `--visibility` and `--team`.
- [Admin handbook](handbook/admin.md) — users, roles and teams from the admin's side.
- In-app help: `getting-started/teams`, `getting-started/visibility`, `getting-started/ownership`,
  `getting-started/labels`, `pages/teams`.
