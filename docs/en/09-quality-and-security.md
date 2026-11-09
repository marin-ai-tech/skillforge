# Quality and security

SkillForge checks every version in several independent ways. Validation decides whether a package can be
published at all. On top of that, each version gets an advisory quality score, a security scan, a context-cost
estimate and, for hooks, a risk table; an admin can turn the scan and company quality rules into hard gates;
every version is signed so that installs can prove the files are intact; and an optional review assistant adds
findings from independent models. This page explains each layer and who controls it. In-app help:
`getting-started/quality`.

| Layer | Blocks publishing? | Who controls it |
|---|---|---|
| Validation (`E_*`, `W_*`) | `E_*` always | built in ([Artifact types](05-artifact-types.md)) |
| Quality score (`Q_*`) | never | built in |
| Security scan | only if the security policy says so (`E_SECURITY_BLOCKED`) | admin |
| Company and team quality rules | only in block mode (`E_RUBRIC_BLOCKED`) | admin, a team's lead |
| MCP policy | always for `mcp-server` (`E_MCP_POLICY`) | admin ([MCP](13-mcp.md)) |
| Signature | checked on install, not on publish | the registry |
| Review assistant and model checks | never | admin installs and configures |

## Quality score

Every version that parses gets a quality report with a `score` from 0 to 100 and a `grade`:

| Grade | Score |
|---|---|
| A | 90 and above |
| B | 75–89 |
| C | 60–74 |
| D | below 60 |

Each `Q_*` check that fires costs 15 points (`warn`) or 5 points (`info`), once per code however many places it
was found. The report is stored with the version, so a new version can improve the grade without changing the old
one. It never blocks publication.

| Code | Severity | Fires when |
|---|---|---|
| `Q_DESC_SHORT` | warn | the description has fewer than 10 words |
| `Q_DESC_NO_TRIGGER` | warn | the description never says when to use the artifact |
| `Q_DESC_NO_BOUNDARY` | info | the description never says when not to use it |
| `Q_DESC_PERSON` | info | the description is written in the first or second person |
| `Q_BODY_LONG` | warn | the main file is longer than about 5000 tokens |
| `Q_REF_DEEP` | warn | a referenced file points to yet another Markdown file |
| `Q_TIME_SENSITIVE` | info | wording that goes stale, such as dates or "the latest version" |
| `Q_WINDOWS_PATH` | warn | a Windows path outside a Windows shell block |
| `Q_TOOLS_UNBOUNDED` | warn | the tool list grants unrestricted shell access |
| `Q_NO_EXAMPLE` | info | no code block or example section |
| `Q_HOOK_NO_TIMEOUT` | warn | a `command` or `http` hook without `timeout` |
| `Q_HOOK_HARD_BLOCK` | info | a hook refuses outright instead of asking |
| `Q_HOOK_BROAD_MATCHER` | warn | a tool hook with no matcher or `*` |
| `Q_HOOK_INLINE_LONG` | info | an inline command longer than 200 characters without a script |
| `Q_SETTINGS_BYPASS` | warn | a settings profile turns on `bypassPermissions` |
| `Q_SETTINGS_BROAD_ALLOW` | warn | a settings allow list unlocks the shell or all tools |
| `Q_SETTINGS_API_KEY_HELPER` | info | a settings profile sets `apiKeyHelper` |
| `Q_SETTINGS_HOOKS` | info | a settings profile embeds hooks |

Which codes apply depends on the type. Skills get the ten general codes; commands skip `Q_REF_DEEP`; agents skip
`Q_REF_DEEP` and `Q_NO_EXAMPLE`; hooks get `Q_TIME_SENSITIVE`, `Q_WINDOWS_PATH` and the four hook codes; settings
profiles get the four settings codes; MCP server descriptions get `Q_DESC_SHORT`, `Q_DESC_PERSON`,
`Q_TIME_SENSITIVE` and `Q_WINDOWS_PATH`. A plugin is scored from its components, and the report lists each
component's grade.

Read the report on the artifact page (`?tab=quality`), as grade chips on catalog cards, and in the Publish preview
after the dry run. The Help control next to a check opens its code topic, for example in-app help:
`codes/Q_DESC_NO_TRIGGER`.

## Hook risk table

A hook runs on its own and can block tools, write files and reach the network, so the report of every hook
contains a table with one row per handler: event, matcher, type, action, timeout, script and a blocking mode
(`block`, `ask`, `none` or `unknown`). Risk labels point at the rows they concern:

| Label | Meaning |
|---|---|
| `blocks_tools` | blocks on `PreToolUse` or `PermissionRequest` |
| `blocks_prompts` | blocks on `UserPromptSubmit` |
| `writes_files` | redirects output or runs commands such as `rm`, `mv`, `sed -i`, `Set-Content` |
| `network` | an `http` handler, or `curl`, `wget`, `Invoke-WebRequest` and similar |
| `every_prompt` | runs on every turn |
| `llm_hook` | a `prompt` or `agent` handler: a model decides |

SkillForge prefers `ask` to a hard block. The analysis reads text and never runs the hook, so treat the labels
as a reading guide and open the script when one surprises you. In-app help: `getting-started/hook-risks`.

## Possible duplicates

Validation and publish also return a `duplicates` list: another artifact of a different type with the same name
(`name_collision`), the same main text (`identical_body`), a shared file of at least 256 bytes (`shared_files`) or
a very similar description (`similar_description`). Duplicates are advisory; usually one of the two artifacts
should be retired. In-app help: `getting-started/duplicates`.

## Context cost

The Quality tab estimates how many tokens the artifact puts into the agent's context:

- **Every turn** — the name and description, which the agent keeps listed all the time.
- **When used** — the body of the main file.
- **Other files, on demand** — reference files read only when needed.

The level is **high** when the description costs more than 200 tokens or the body more than 5000, **medium** above
100 or 2500, otherwise **low**. A high level shows a "Costly context" chip on catalog cards. Hooks, settings and
MCP server descriptions cost nothing here; a plugin adds up its components. To lower the cost, shorten the
description and move detail into reference files.

## Security scan

Every version gets a built-in scan for patterns that hurt the people who install it. It is shown first on the
Quality tab and as a risk chip on catalog cards. Each finding names its rule, file and line; a key in a finding
is shortened.

| Rule | Severity | Looks for |
|---|---|---|
| `pipe_to_shell`, `remote_exec_powershell`, `base64_exec` | high | commands that download and run code |
| `instruction_override` | high | text telling the agent to ignore its instructions or hide things from the user |
| `exfiltration` | high | sending secrets, keys or environment variables out |
| `hidden_unicode` | high | invisible or direction-changing characters |
| `secret_literal` | high | keys and tokens pasted into the text |
| `credential_paths` | medium | paths such as `~/.ssh/` or `~/.aws/credentials` |
| `destructive` | medium | `rm -rf /`, `git push --force`, `git reset --hard` and similar |
| `guard_bypass` | medium | `--no-verify`, `--dangerously-skip-permissions`, `bypassPermissions` |

The verdict is **fail** when a high-severity pattern is found as an instruction, **warn** for any other finding,
and **pass** when nothing is found. A line that only warns about a pattern ("never pipe curl into sh") is marked
as a mention and gives **warn**, never pass, so writing "never" in front of an attack does not hide it. Hidden
characters and literal secrets count wherever they appear. The scan does not change the A–D grade.

A pass means none of these patterns were found, not that the artifact is safe. Review still decides.

On install, the CLI warns about **warn** and refuses a **fail** until you have reviewed it and pass
`--allow-risky`:

```bash
skillforge install skill/release-notes --runtime codex --allow-risky
```

### Security policy

An admin sets the security policy on the lifecycle policy page (`/admin/lifecycle`) or with
`PUT /api/v1/admin/security-policy`. `block_publish_on` is `none` (the default), `high` or `medium`. With `high`,
a version with a high-severity finding that is not a mention is refused with `E_SECURITY_BLOCKED`; with `medium`,
medium findings are refused too. The policy applies to Publish, Import, mirrors and agent-snapshot publishing,
and to everyone, admins included.

## Company and team quality rules

An admin can add company rules on `/admin/lifecycle`; the lead of a team can add team rules on the team page.

| Part | Meaning |
|---|---|
| threshold | a score from 0 to 100 |
| mode | `off`, `warn` or `block` |
| weights | the points each `Q_*` check costs when it fails |
| criteria | up to 50 company checks: `require_heading`, `require_file` (such as `README.md`) or `forbid_phrase` |

The rules score is 100 minus the weights of everything not met; a failed check without a weight costs 15
(`warn`) or 5 (`info`). In block mode a version below the threshold is refused with `E_RUBRIC_BLOCKED`; in warn
mode it is published and the score is shown. The score is kept with the version and shown on the Quality tab.

Team rules can only be stricter than the company's: a lower threshold, a weaker mode or a lower weight is refused
with `rubric_looser`. An artifact of a team gets both rule sets. Every change of the rules is recorded in the
audit log. The API is `GET|PUT /api/v1/admin/quality-rubric` and `GET|PUT /api/v1/teams/<team>/quality-rubric`.

## Signed versions

The registry signs the exact file list of every version it publishes with an Ed25519 key. The key lives in the
data folder (`signing/ed25519.pem`), is created on first start, and its public part is published at
`/api/v1/install-info`. Versions published before signing existed are signed when the server starts.

`skillforge install` and `skillforge sync` check every file and the signature before writing anything:

- a changed, missing or extra file stops the install with `does not match`;
- a damaged copy in the registry stops it with `blob_corrupt`;
- a version without a signature installs with a `not signed` warning;
- if the registry key differs from the one remembered at `skillforge login`, the install stops with
  `signing key changed` until you sign in again.

A signature proves the files are the ones this registry holds; whether a version was approved is its lifecycle
status. Installs through the Claude Code plugin marketplace do not go through the CLI and are not checked. Back up
the signing key with the data folder ([Backups and operations](20-backups-and-operations.md)).

## Review assistant

The review-assistant server plugin adds an independent, evidence-backed review. When a version enters the review
queue, the plugin starts a run: several external reviewers, each a different model, audit the artifact against a
checklist, and a judge merges their findings with an agreement count. Each finding has a category, file and line,
severity and a suggestion. A reviewer resolves every finding:

| Decision | When |
|---|---|
| Fix | the finding is right; the artifact must change |
| Verify | plausible but unproven; make a targeted check |
| Defer | accepted for later, with a reason |
| Reject | disproven, a duplicate or a matter of taste |

The finished run is stored as evidence on the version. Operators list reviewers in a JSON file named by
`SKILLFORGE_REVIEWERS_FILE`, read on every run; each entry names the model, the command and its environment.
Reviewers must run without tools, so they cannot read the operator's files or tokens or reach the network.
See [Server plugins](14-plugins.md).

### Skill checks with a model

When an LLM is connected on the Assistant page and skill checks are on, every published skill version gets a
background check by a single model. Publishing does not wait for it. A finding is kept only if its quote is really
in the file. An error, a timeout or a used-up daily budget means the skill was not checked, not that it is clean.
Repeat a check with **Check with model** on the Review tab; check older skills with **Check published skills** on
the Assistant page.

A check does not change the status and does not count as review evidence. Only skills are checked, and the full
text of a checked skill goes to the provider, including skills visible to one team only.

## See also

- [Lifecycle and review](07-lifecycle-and-review.md) — where these reports feed a decision.
- [Artifact types](05-artifact-types.md) — the Blocking and Warning codes.
- [Reviewer handbook](handbook/reviewer.md) — a reviewer's checklist.
