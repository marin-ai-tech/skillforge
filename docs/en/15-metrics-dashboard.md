# Metrics dashboard

The metrics dashboard shows, across the whole registry, how artifacts are used and whether they help: sessions,
verification pass rate, transfer rate, ablation uplift and a token estimate. The numbers come from three sources:
session facts uploaded by the CLI ([Session metrics](16-session-metrics.md)), usage reports, and ablation evidence
([Skill evals](17-skill-evals.md)). This page defines each metric and describes the `/metrics` page, the artifact
card panel, the API, the export and the report for management.

## Definitions

| Metric | Meaning | Source |
|---|---|---|
| Transfer Rate | helped / uses across all versions; empty when uses = 0 | usage reports |
| Ablation Score | `uplift` of the latest ablation evidence; empty when there is none | ablation evidence |
| Skill Age | days since the artifact was created | registry timestamps |
| Verification Pass Rate | pass / (pass + fail) over session facts; empty when there are none | session facts |
| Token Cost | `ceil(sum(size) / 4)` over the text files of the latest non-purged version | version file sizes |
| Token Efficiency | `round(transfer_rate / (token_cost / 1000), 3)`; empty when the rate or the cost is missing or zero | derived, an **estimate** |

Token Cost and Token Efficiency are labelled as estimates (`token_cost_estimated: true`). They are computed from
file sizes, not from measured model spend.

### Token estimate

1. Take the files of the latest non-purged version with the extensions `.md`, `.txt`, `.json`, `.yaml`, `.yml`,
   `.toml`.
2. `token_cost = ceil(sum(sizes) / 4)`.
3. `token_efficiency = round(transfer_rate / (token_cost / 1000), 3)` when `transfer_rate` is known and
   `token_cost > 0`.

The Quality tab shows a finer context cost (what loads on every turn, when the artifact is used, and on demand);
see [Quality and security](09-quality-and-security.md).

## The `/metrics` page

**Metrics** in the navigation opens the board: totals for the filtered set (artifacts, sessions, transfer,
ablation), filters by search text, type, status and team, sortable columns, pagination, and **CSV** / **JSON**
export buttons for signed-in users. The artifact page has a metrics panel with the same per-artifact numbers, so the
card and the board always agree. In-app help: `pages/metrics` and `getting-started/reading-metrics`.

## Who sees what

| Surface | Who |
|---|---|
| Board | anyone allowed to read the catalog; team artifacts only for team members, owners, co-authors, reviewers and admins |
| Export | signed-in users only |
| Card metrics | same as reading the artifact |

Purged artifacts never appear; retired artifacts are hidden unless you filter for them.

## Board API

```
GET /api/v1/metrics/overview?type&status&team&q&sort&order&limit&offset
```

- `sort`: `name`, `status`, `skill_age_days`, `sessions_count`, `verification_pass_rate`, `transfer_rate`,
  `ablation_score`, `token_efficiency` or `last_used_at` (default `transfer_rate`).
- `order`: `asc` or `desc` (default `desc`; empty values always last).
- `limit` 1–200 (default 50), `offset` ≥ 0, `q` up to 64 characters.
- Response: `{ totals, items, next_offset }`. `totals` covers the whole filtered visible set, not just the page.

`GET /api/v1/artifacts/:type/:name/metrics` returns the same per-artifact fields (`uses`, `helped`,
`transfer_rate`, `ablation_score`, `token_cost`, `token_efficiency`, `token_cost_estimated`) plus the session
metrics.

## Export

```
GET /api/v1/metrics/export?format=csv|json
```

Takes the same filters and sort as the board, without pagination, up to 5000 rows.

- Signed-in users only: anonymous requests get `401`, MCP tokens get `403 mcp_token_forbidden`.
- JSON: `{ generated_at, truncated, columns, items }`.
- CSV: UTF-8 without BOM, CRLF line ends, a fixed column order, strings quoted with doubled quotes; `X-Truncated:
  true` when rows were cut off.
- **Spreadsheet safety:** a text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a
  leading `'`, so a spreadsheet does not run it as a formula. Numbers (including a negative ablation score) are left
  as they are; empty values stay empty.
- The response is a download (`Content-Disposition: attachment; filename="skillforge-metrics-<date>.csv"` or
  `.json`) and is never cached (`Cache-Control: no-store`).

## CLI

```bash
skillforge metrics [--type <type>] [--status <status>] [--team <name>] [--q <text>] \
  [--sort <field>] [--order asc|desc] [--limit <n>] [--offset <n>] [--json | --csv]
```

Without a flag it prints a table; `--json` prints the overview, `--csv` downloads the export (sign-in required).

## Report for management

`/admin/report` (admins only) answers a manager's questions from session usage facts:

- sessions, people and active artifacts over 7, 30, 90 or 365 days, compared with the previous period of the same
  length;
- sessions by week;
- a table by consuming team, with a context token estimate;
- a table by artifact;
- `active`, `aging` and `zombie` artifacts nobody used in the period.

The same data as JSON: `GET /api/v1/admin/report?days=30` (`days` 1–365). The context estimate is sessions ×
(the every-turn cost + the when-used cost) from the Quality tab's context cost, so real use can be higher. In-app
help: `pages/admin-report`.

## See also

- [Session metrics](16-session-metrics.md)
- [Skill evals](17-skill-evals.md)
- [Lifecycle by data](08-lifecycle-by-data.md) — the same signals drive automatic aging and zombie moves
- [Quality and security](09-quality-and-security.md)
- [Admin handbook](handbook/admin.md)
