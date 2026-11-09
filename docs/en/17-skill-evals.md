# Skill evals

Skill evals measure a skill's quality before a version reaches `stable`. An **eval suite** is a set of cases —
*trigger* cases (does the skill fire on this prompt?) and *task* cases (does the answer pass these checks?) — with
an optional **acceptance gate** that guards the stable channel. The operator connects **runners**, local programs
that call a model or an agent; the registry itself never embeds a judge model and never checks answers with regular
expressions. This page covers the suite format, runners, run kinds, batches, cost per solved task, the gate, the CLI
and the Evals tab.

## Suite format

A suite is saved with `PUT /api/v1/artifacts/:type/:name/evals` (or `skillforge evals push --file`):

```json
{
  "gate": "off",
  "cases": [
    {
      "id": "fire-1",
      "kind": "trigger",
      "prompt": "please extract pdf text",
      "expect_trigger": true,
      "holdout": false
    },
    {
      "id": "task-1",
      "kind": "task",
      "prompt": "summarize the doc",
      "holdout": true,
      "checks": [{ "type": "contains", "value": "ANSWER", "ci": false }]
    }
  ]
}
```

Rules:

- Skills only (`type=skill`). Body up to 256 KiB, at most 100 cases.
- Case `id`: kebab-case, up to 40 characters, unique in the suite.
- `kind`: `trigger` (needs `expect_trigger`) or `task` (needs 1–10 checks of type `contains`, `not_contains` or
  `equals`, with optional case-insensitive `ci`).
- `holdout: true` marks cases kept back for the gate. Eval routes require manage rights on the artifact, so people
  who cannot manage it never see the holdout cases.
- `gate: required` needs at least one holdout case (`422 gate_needs_holdout` otherwise). Turning the gate from
  `required` back to `off` takes a reviewer or admin.

Regular-expression checks and model-as-judge checks are not supported, on purpose: checks stay simple, readable and
deterministic.

## Runners

The operator lists runners in a JSON file and points `SKILLFORGE_EVAL_RUNNERS_FILE` at it:

```json
{
  "runners": [
    {
      "id": "mock",
      "label": "Mock",
      "command": ["node", "/path/to/runner.mjs"],
      "timeout_s": 60,
      "env": ["PATH"]
    }
  ]
}
```

Without the file, or with an empty list, every run answers `503 runners_not_configured`.

### Runner protocol

A runner reads one JSON request on stdin and writes one JSON response on stdout.

- Request: `{ "protocol": 1, "mode": "trigger" | "task", "prompt": "...", "skill": { "name", "description",
  "files": [{ "path", "content" }] } | null }`. `skill` is `null` for the "without the skill" side of an ablation.
- Trigger response: `{ "triggered": true | false }`.
- Task response: `{ "output": "..." }` (up to 64 KiB; the server truncates longer output). It may also include
  `usage: { input_tokens, output_tokens }` (non-negative integers), `cost_usd` (a non-negative number) and `model`
  (a string) for the cost table below; malformed fields are dropped without failing the task.

### Isolation

- The runner is started without a shell, in a temporary working directory, with only the environment variables
  listed in `env`; `SKILLFORGE_*` variables are never passed.
- On timeout the whole process tree is killed.
- Skill files are passed as data. Version labels (which side is the baseline and which the candidate) are **not**
  sent, so a runner cannot favour one side.
- A runner still runs as the server's operating-system user and shares its file system; treat the runners file as
  code the operator trusts ([Orchestration](18-orchestration.md) describes the same model for workflows).

## Run kinds

| Kind | What it does |
|---|---|
| `trigger` | runs the trigger cases; summary `{ recall, specificity, accuracy }` |
| `compare` | blind A/B of `version` against `against` (default: the current stable version); the summary has the pass rate of each side, `wins_*` and `ties` |
| `ablation` | runs the task cases with the skill and without it; an error-free run can write `ablation` evidence, which the lifecycle and metrics use ([Lifecycle by data](08-lifecycle-by-data.md)) |

Start a run with `POST /api/v1/artifacts/:type/:name/evals/runs` or from the Evals tab.

Limits:

- one run at a time per artifact (`409 run_in_progress`);
- a daily cap per artifact, `SKILLFORGE_EVAL_MAX_RUNS_PER_DAY` (default 20 per UTC day, `429 rate_limited`);
- case processes run in parallel up to `SKILLFORGE_EVAL_CONCURRENCY` (default 2, at most 8).

`output_excerpt` in results is plain text of up to 500 characters for people and the UI; it is never rendered as
HTML.

## Batches across runners

`POST /api/v1/artifacts/:type/:name/evals/batches` with `{ version, kind, scope?, against?, runners? }` (same rights
and error codes as single runs; answers `202`) queues one child run per runner — every configured runner when
`runners` is omitted.

- Children run one after another in the normal queue, appear in the run list and count against the daily cap; the
  artifact audit records `eval_batch`.
- `GET …/evals/batches` lists batches; `GET …/evals/batches/:id` shows one batch with its `runs[]` and
  `summary.saturation`: `evaluated_runs`, `saturated_cases[]` and `saturated`, which is `true` only when at least two
  runs were evaluated and every case passed in all of them (the suite is too easy to tell the runners apart).
- Status goes `queued` → `running` → `done`. A failed child, or an exhausted daily cap (`budget_exhausted`), makes
  the batch `failed` with an `error`.

With `SKILLFORGE_EVAL_ABLATION_AUTO=true`, every newly published skill version queues an ablation batch
automatically when the suite has a task case.

## Cost per solved task

A runner entry may also say which model and agent it stands for and what it costs:

```json
{
  "id": "small",
  "label": "Small model",
  "command": ["node", "/path/to/runner.mjs"],
  "model": "model-s",
  "agent": "claude-code",
  "price": { "input_per_mtok": 1, "output_per_mtok": 2 }
}
```

The cost of a task is the runner's reported `cost_usd`; otherwise the reported tokens × `price` (USD per million
tokens); otherwise unknown.

`GET /api/v1/artifacts/:type/:name/evals/cost` (same rights as eval runs) returns one cell per runner and side of
the latest finished **compare** and **ablation** runs: `runner`, `model`, `agent`, `kind`, `version`, `against`,
`side`, `tasks`, `passed`, `pass_rate`, `input_tokens`, `output_tokens`, `cost_usd` and
`cost_per_solve = cost_usd / passed`.

- If any task in a cell has no data, the sums are empty rather than partial.
- `cost_per_solve` is empty when `passed = 0` or the cost is unknown.
- Cells are sorted by `cost_per_solve`, cheapest first, unknown last. A model that is cheaper per task can still
  cost more per solved task.

The Evals tab shows the same table.

## Acceptance gate

With `gate: required`:

- A new publish without an explicit channel lands on **beta**, even when the version has no pre-release suffix. An
  explicit `"channel": "stable"` publish is refused with `409 eval_gate_required`.
- Promoting a version from `beta` to `stable` while another stable version exists needs a fresh holdout **compare**
  run — newer than the publish and than the last suite change — with `errors = 0` and no regression on task or
  trigger cases. Otherwise the answer is `409 eval_gate_missing` or `409 eval_gate_failed` with a `reason`.
- The first stable version (no stable version yet) needs no compare.
- Moving a version from `stable` back to `beta` is never blocked.

Channels themselves are described in [Versions and channels](10-versions-and-channels.md).

## CLI

```bash
skillforge evals skill/my-skill --json
skillforge evals push skill/my-skill --file suite.json --gate required
skillforge evals run skill/my-skill --kind trigger --version 0.1.0 --wait --json
skillforge evals run skill/my-skill --kind compare --version 0.2.0 --against 0.1.0 --scope holdout --runner mock --wait
skillforge evals runs skill/my-skill
skillforge evals batch skill/my-skill --kind ablation --version 0.2.0 --runner small,large --wait
skillforge evals batches skill/my-skill
skillforge evals journal skill/my-skill --json
```

Exit codes: `0` ok, `1` validation error or a failed `--wait`, `2` conflict or a bad local flag or file, `3` no
registry configured, `4` authentication or rights, `6` not found.

## The Evals tab

On a skill's page, people who manage the artifact see the **Evals** tab (`?tab=evals`): the suite editor, the gate
switch, the run form, the run list (refreshed while runs are in progress), the per-version journal and the cost
table. A channel error on the Versions tab links back to this tab.

## See also

- [Versions and channels](10-versions-and-channels.md)
- [Quality and security](09-quality-and-security.md)
- [Lifecycle by data](08-lifecycle-by-data.md)
- [Metrics dashboard](15-metrics-dashboard.md)
- [Orchestration](18-orchestration.md)
- [Contributor handbook](handbook/contributor.md)
