# Session metrics

Session metrics show how often a skill is actually used in agent sessions and whether the work around it passed
its checks. The CLI reads your local agent session logs, extracts a few facts about registry skills, and uploads
only those facts. This page explains what is sent and what is not, how the numbers are defined, the limits, the
CLI command and the API.

## Privacy

Session transcripts stay on your machine. The CLI parses Claude Code JSONL session logs locally and uploads four
fields per use of a skill that is visible in the registry:

| Field | Content |
|---|---|
| `skill` | the registry skill that was used |
| `session_key` | a 32-hex hash of the session id, not the id itself |
| `used_at` | when the skill was used |
| `verification` | `pass`, `fail` or `none` (see below) |

Prompts, commands, file paths, raw session ids and the names of your private local skills are never sent or
stored. The server table `session_facts` has no columns for text, paths, commands or raw session ids. You can
delete everything you uploaded at any time (see API below).

## Definitions

| Metric | Meaning |
|---|---|
| `sessions_count` | distinct `session_key` values across all reporters |
| `users_count` | distinct reporters |
| Verification Pass Rate | `round(pass / (pass + fail), 3)`; empty (shown as "—") when pass + fail = 0 |
| Skill Age | whole days from the first version's `published_at` to now |
| `versions[].sessions_count` | distinct sessions attributed to that version |

The server decides which version a fact belongs to: the newest version with `published_at <= used_at`, otherwise
the earliest published version.

## How verification is detected

After a skill is called, the CLI looks at the shell commands the agent ran until a different skill is called or the
session ends, and takes the last command that looks like a test, build or lint run. Recognised patterns (case
insensitive, whole words): `npm test`, `npm run test|build|lint`, `pnpm|yarn test|build|lint`, `node --test`,
`npx playwright test`, `pytest`, `python -m pytest|unittest`, `go test`, `cargo test|build|check`,
`make test|check|lint`, `mvn test`, `gradle test`, `dotnet test|build`, `tsc`, `eslint`, `ruff`, `phpunit`,
`rspec`.

The result is `pass` when the command did not end in an error and reported no non-zero exit code, `fail`
otherwise. When no such command ran, the fact is `none` and does not count towards the pass rate.

## Limits

| Limit | Answer |
|---|---|
| more than 1000 facts in one batch | `400 batch_too_large` |
| body larger than 512 KiB | `413` |
| more than 5000 **new** facts per user per UTC day | `429 rate_limited` |
| an MCP token | `403 mcp_token_forbidden` |
| `used_at` more than a day in the future or older than about two years | counted as `rejected` |
| an unknown skill, or one you cannot see | counted as `unknown` (whether it exists is not revealed) |
| a fact already uploaded (same reporter, artifact, `session_key` and `used_at`) | counted as `duplicates`; uploads are idempotent |

## CLI

```bash
skillforge sessions import [--harness claude-code|opencode] [--root <dir>] [--since <date>] [--dry-run] [--json]
```

- `--root` defaults to `~/.claude/projects`, or `SKILLFORGE_SESSIONS_ROOT` when set.
- `--harness opencode` reads OpenCode session exports (`opencode export <session-id> > <dir>/<session-id>.json`)
  and needs `--root <dir>`: OpenCode has no documented session store. A completed `skill` tool call is a use; the
  last test or build command after it decides `pass` or `fail`.
- `--since` uploads only facts with `used_at` on or after that ISO date.
- `--dry-run` prints the facts that would be sent and uploads nothing, so you can check exactly what leaves the
  machine.

Exit codes: 0 success, 2 bad arguments, 3 no registry configured, 4 not signed in, 6 sessions root not found.

## API

| Request | Purpose |
|---|---|
| `POST /api/v1/me/session-facts` `{ source, facts }` | upload facts |
| `DELETE /api/v1/me/session-facts[?source=]` | delete your facts (all, or from one source); returns `{ deleted }` |
| `GET /api/v1/artifacts/:type/:name/metrics` | per-artifact metrics (public read, subject to visibility) |
| `GET /api/v1/me/overview` | your overview, including `sessions` |

The artifact card also shows `skill_age_days`.

## See also

- [Metrics dashboard](15-metrics-dashboard.md)
- [Lifecycle by data](08-lifecycle-by-data.md) — session use counts as activity
- [Claude Code](agents/claude-code.md)
- [Viewer handbook](handbook/viewer.md)
