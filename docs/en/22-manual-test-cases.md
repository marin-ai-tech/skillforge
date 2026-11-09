# Manual test cases

A checklist for testing a SkillForge build by hand before a release or after an
upgrade. It covers the whole product surface: access, catalog, publishing,
install into agent runtimes, channels and lifecycle, teams, comments, evals,
orchestration, metrics, purge, administration, CLI and MCP. Many cases also have
automated coverage, named in the last column, so a manual run can focus on what
automation cannot see.

## How to read

- **Priority:** P0 — release blocker; P1 — core functionality; P2 — edge cases.
- **Auto:** existing coverage (`e2e/<spec>` — Playwright; `sim:mvp` —
  `scripts/simulate-mvp.mjs`; `unit`/`node` — automated tests). "—" — manual only.
- **Real client** in the priority column — the case needs a real agent client
  installed on the test machine (see [Agents](agents/README.md)).
- **Result:** pass · fail (file a bug with steps, expected and actual result) ·
  skipped (give the reason) · warning (passes with a remark).
- Test roles: `admin`, `rev1` (reviewer), `dev1`, `dev2` (contributor),
  `viewer1` (viewer); team `alpha` (lead `dev1`, member `viewer1`).
- Before a series: start a registry ([Self-hosting](03-self-hosting.md) or
  `npm run local:start`) and create the roles above
  ([Cookbook](21-cookbook.md), recipe 1). Automated pass: `npm run e2e:mvp`,
  `npm run simulate:mvp`, full suite — `npx playwright test --project=Edge`.

## A. Access and roles

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| A.1 | P0 | Anonymous: `/`, catalog, org artifact card | Reading works; no publish/purge buttons; `/publish` → login redirect | e2e/auth, e2e/comments |
| A.2 | P0 | Wrong password; correct password with `next=` | Error message; return to the target page | e2e/auth |
| A.3 | P1 | `viewer1`: `/publish`, `/admin/users`, `/lifecycle`, purge button | `publish-forbidden`, `admin-forbidden`, `lifecycle-forbidden`, no button | e2e/auth, e2e/purge |
| A.4 | P1 | Change password in `/me/password`; sign in with new | Old fails, new works | e2e/users |
| A.5 | P1 | Token in `/me/tokens`: create, revoke | Works in CLI/API until revoked; then 401 | e2e/users |

## B. Catalog and artifact card

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| B.1 | P0 | Catalog: search, type filter, pagination | Relevant cards; filters narrow the list | e2e/catalog |
| B.2 | P0 | Card: name, type, status, version, digest, visibility, labels | All fields shown and correct | e2e/catalog |
| B.3 | P1 | Tabs Overview/Files/Install/Quality/Evidence/Audit | Each tab renders without errors | e2e/catalog, e2e/quality |
| B.4 | P1 | Nonexistent artifact/path | `not-found` with the name | e2e/catalog |
| B.5 | P1 | `watch` toggle on the card | Watch state persists; new version → notification | — |

## C. Publishing and import

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| C.1 | P0 | `dev1` publishes a new skill (UI `/publish` and CLI) | Artifact created as `candidate`, v0.1.0; `published_by = dev1` | e2e/publish, e2e/auth |
| C.2 | P0 | Republish identical content | `digest_exists`, no new version | node |
| C.3 | P1 | Second version with edited content | Version 0.2.0; changelog shown; artifact status unchanged (an `active` artifact stays `active`) | e2e (global-setup) |
| C.4 | P1 | `dev2` publishes someone else's artifact | `not_owner` conflict in preview; run skips/fails | node (artifact-ownership-entries) |
| C.5 | P1 | Zip import: preview → run | Candidates with conflicts before run; `skip_conflicts` skips them | e2e/import |
| C.6 | P1 | git/dir import with provenance | `provenance.source=import`, ref stored; entry in `/provenance` | node |
| C.7 | P2 | Invalid bundle (no name, broken frontmatter) | Clear error, no partial write | node |

## D. Install and runtimes

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| D.1 | P0 | `install skill/pdf-tools --runtime claude-code` | `.claude/skills/pdf-tools/` + lock file | node (runtime-install) |
| D.2 | P0 | Same for `codex`, `gemini`, `cursor`, `opencode`, `qwen`, `devin`, `reckon` | `.codex`/`.gemini`/`.cursor`/`.opencode`/`.qwen`/`.agents`/`.reckon/skills/<name>/` dirs | node (runtime-install, reckon-runtime) |
| D.3 | P1 | `command` to gemini/cursor/opencode/qwen → translation; codex/devin/reckon → refusal | TOML/MD output; refusal with reason | node |
| D.4 | P1 | `agent` to each non-Claude runtime; `hook`/`plugin`/`settings` to each non-Claude runtime | `agent`: installed for codex (`.codex/agents/<name>.toml`), cursor, opencode, qwen; refused with reason for gemini/devin/reckon (no subagent format). `hook`/`plugin`: refused, install via `/plugin install` in Claude Code; `settings`: refused (targets Claude Code `settings.json`) | node |
| D.5 | P1 | `sync` after a version update in the registry | Installed copy updated; local edits → dirty | node |
| D.6 | P1 | `uninstall` | Files and lock entry removed | node |
| D.7 | P1, real client | Real Claude Code: skill usable, `/plugin install` for hooks | Skill triggers; hook installs via marketplace | — |
| D.8 | P1, real client | Real Reckon: installed skill visible; "learned" skills untouched | The installed skill is listed and used by Reckon; skills Reckon wrote itself are not changed or removed by `install`, `sync` or `uninstall` | — |
| D.9 | P2 | `settings apply` profile (Claude Code) | `settings.json` applied with backup | node |

## E. Channels and lifecycle

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| E.1 | P0 | Versions: publish `1.1.0` with `"channel": "beta"` → `Promote to stable`; then `Move to beta` on it | `beta` badge, then `stable`; `stable x.y.z` on card; after `Move to beta` the previous stable version is `latest` again | e2e/channels |
| E.2 | P1 | Pre-release version `1.2.0-beta.1` | Always `beta`; promotion to `stable` refused with `channel_invalid` | — |
| E.3 | P1 | reviewer: `/lifecycle?tab=review` queue → promote | `active`; audit entry; the author of the latest version cannot promote it | e2e/lifecycle, sim:mvp |
| E.4 | P1 | `retired` without reason / with reason | Button disabled → transition after reason | e2e/lifecycle |
| E.5 | P1 | Sweep (`admin`): `aging`→`revalidate`, `retired`→`restore` | Boards update; `aging` returns to `active`, `retired` returns to `candidate` | e2e/lifecycle |
| E.6 | P1 | Candidate older than `SKILLFORGE_CANDIDATE_TTL_DAYS` | Still `candidate`; listed under Clean up today with reason `stale_candidate`; never moved to `zombie` | — |
| E.7 | P2 | Invalid manual transition, e.g. `candidate` → `aging` | `409 invalid_transition` | — |
| E.8 | P2 | Version validation (model_compat + note) | `Validated` mark on the version row | e2e/lifecycle |
| E.9 | P2 | `Promote to stable` with `gate: required` and failing gate | Channel error linking to Evals | — |

## F. Teams and visibility

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| F.1 | P0 | `owner_team` artifact: member opens it, outsider cannot | Member sees the card; outsider — NotFound + API 404 | e2e/teams-visibility |
| F.2 | P1 | Owner: `org` → `team` → back to `org` | Both directions work (reversibility) | node (teams-visibility) |
| F.3 | P1 | `/teams`: list, team page, members | Name/lead/roster; counters visible to members | e2e/mvp-flows |
| F.4 | P1 | Non-member reviewer sees team artifact | Access works (moderation) but not "owner" rights | node |
| F.5 | P2 | Publish into a team you are not a member of | `not_team_member` | node |

## G. Comments and notifications

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| G.1 | P0 | `dev1` posts `@viewer1` in Comments → `viewer1` signs in | `notif-count` ≥1; `/me/notifications` row linking the artifact | e2e/comments |
| G.2 | P1 | Edit own comment; delete it | `(edited)`; `[deleted]` after confirm | e2e/comments |
| G.3 | P1 | Reply, version filter | Nesting; filter hides other versions | e2e/comments |
| G.4 | P1 | Watcher notification on new version | Bell + feed notification | — |
| G.5 | P1 | `Mark all read`, `notif-pref-*` preferences | Counter resets; disabled kind never arrives | — |
| G.6 | P2 | Empty/overlong comment | `comment_invalid` error, nothing written | node |

## H. Evals and quality

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| H.1 | P1 | Evals: add a case, `Save suite` | Suite persisted, no error | e2e/evals |
| H.2 | P1 | `gate=required` with no holdout cases | Refusal "Cannot enable … without holdout" | e2e/evals |
| H.3 | P1 | Start a run with no runners configured | "No eval runners are configured" error | e2e/evals |
| H.4 | P1, real client | Run with a configured runner: trigger/task cases | Results in the journal; gate outcome | — |
| H.5 | P2 | Quality tab: `Q_*` signals on a weak skill | Meaningful warnings shown | e2e/quality |
| H.6 | P2 | Evidence: per-version evidence after review | Entries visible on the tab | e2e/zz-review-assistant (env-limited) |

## I. Orchestration

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| I.1 | P2 | Orchestration off (default): open the Workflows API | `403 feature_disabled`; Workflows/Routines tabs hidden | — |
| I.2 | P2 | Workflows tab: admin saves a workflow, a manager runs it | UI opens; run appears in the runs table; a non-admin cannot save a definition | node (workflow-engine) |
| I.3 | P2 | Routines tab: schedule, enable | Routine list; state persists | node (routines-engine) |
| I.4 | P2 | Provenance: `GET /artifacts/:type/:name/provenance` | publish/eval/workflow entries in order; `POST …/derive` by owner | node (provenance-ledger) |
| I.5 | P2 | Overhang: `GET …/overhang`, `/lifecycle/overhang` report | Verdict on fresh ablation data; reviewer+ only | node |

## J. Metrics and export

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| J.1 | P1 | `/metrics`: total cards, filters | Numbers >0 after seeds; filters narrow | e2e/metrics |
| J.2 | P1 | CSV export (signed in) / anonymous | `.csv` downloads; anonymous gets the sign-in hint | e2e/metrics |
| J.3 | P2 | JSON export; pagination of a long list | Valid file; pages navigate | — |

## K. Metadata and purge

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| K.1 | P0 | Version purge: reason + exact confirm | "Purged"; `version-purged` badge; version emptied | e2e/purge |
| K.2 | P0 | Artifact purge: full dialog | `artifact-purged` tombstone; audit cascade | e2e/purge |
| K.3 | P1 | viewer/contributor: purge buttons | No trigger rendered (admin only) | e2e/purge |
| K.4 | P1 | Metadata: labels/description via MetadataPanel | Changes on the card and in audit; no new version | — |
| K.5 | P2 | Purge + `delete_backups`: backup removed | `backups_deleted` in the result | node |

## L. Administration

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| L.1 | P0 | `/admin/users`: create, change role, disable, re-enable | All operations; `last_admin` protection | e2e/users |
| L.2 | P1 | `/admin/backups`: create, download, delete | Archive downloads; restore hint shown | e2e/backups |
| L.3 | P1 | `/admin/plugins`: list; plugin ext-* tab | hello listed; ext page opens | e2e/plugins |
| L.4 | P1 | `/admin/agents`: roots, rescan, bad path, removal | Meaningful statuses and errors | e2e/zz-agents |
| L.5 | P2 | `/admin/lifecycle`: aging/TTL thresholds | Policy persists and applies | node |

## M. CLI and MCP

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| M.1 | P0 | `login`, `whoami`, `logout`, `health` | Exit codes 0/3/4 per contract; clean messages | cli.test |
| M.2 | P1 | `list`, `search`, `info` | Filters and card fields | cli.test |
| M.3 | P1 | `doctor` on a project without/with a lock file | Environment and mismatch diagnosis | node (cli-doctor) |
| M.4 | P2 | `skillforge mcp` started by an MCP client with an MCP token | The stdio bridge answers `tools/list`; search returns only `active` artifacts; a regular API token is refused with `mcp_not_allowed` | node |

## N. Real clients

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| N.1 | P0, real client | Full Claude Code cycle in an empty project and in a project with its own `.claude` folder | Login, install, the skill triggers in a session, `sync` after a new version, `uninstall`; existing files of the project are not touched | — |
| N.2 | P1, real client | Reckon: install, use, `sync`, `uninstall` of a skill | As D.8 | node (partial) |

## O. Negative and resilience

| ID | Pri | Steps | Expected | Auto |
|---|---|---|---|---|
| O.1 | P1 | Expired session: 401 → login with `next` | Back to the page after sign-in | e2e/auth |
| O.2 | P1 | Double-submitting forms (publish, comment) | Single record; buttons disabled in flight | — |
| O.3 | P2 | `E2E_PORT` occupied by a foreign server | global-setup fails with a clear error | node (global-setup) |
| O.4 | P2 | Very long inputs (name, search, comment) | Validation/truncation, no layout breakage | — |

## See also

- [User guide](02-user-guide.md)
- [Cookbook](21-cookbook.md)
- [Lifecycle and review](07-lifecycle-and-review.md)
- [Versions and channels](10-versions-and-channels.md)
- [Quality and security](09-quality-and-security.md)
