---
title: Provenance
summary: Where a version came from, recorded as its source and reference. Accurate provenance helps reviewers decide what to evaluate first.
section: publishing
learn:
  - What each provenance source means
  - Where to set provenance on Publish and Import
  - Which other fields a version carries
  - Which source to choose for hand-written, learned and bulk-imported packages
related: getting-started/versions-and-digests, actions/publish/fields
---

Each artifact version stores `provenance: { source, ref }`. Allowed `source` values on Publish are **human**, **reckon**, **agentspace**, **dreamteam**, **import**, **agent** and **harvest**; Import offers the first five. Default is `{ source: "human", ref: null }`. Invalid sources are rejected as `provenance_invalid`. Provenance answers where a package came from; digests answer what exact bytes were stored; lifecycle status answers whether you should still use it.

## Sources

- **human** — Authored and uploaded by a person through UI or CLI.
- **reckon** — learned skills from a Reckon agent; put the run id in `ref` when available.
- **agentspace** / **dreamteam** — Team pipeline origins; use `ref` for job or repo identifiers.
- **import** — Brought in from outside: upstream mirrors, starter packs and tracked sources always write it. The Import page keeps the source it detects (for example reckon for `.reckon/skills`, human for a plain folder) unless you choose import.
- **agent** — Published from an agent snapshot (`skillforge agent publish` or the Agents page).
- **harvest** — A draft made by rule harvesting from review comments or agent sessions.

## Where you set it

On the Publish form (see Publish fields), choose source and optional ref before submit. On the Import page, candidates keep scanned provenance (for example reckon for `.reckon/skills/*.md`); you may override with the provenance select before Run. Bulk git or zip intakes should usually keep the detected source. The value is stored on the version and shown in Overview metadata. It does not replace digest checks; two imports with different provenance but identical bytes still collide on `digest_exists` for that artifact identity.

## Related version fields

Versions also carry changelog, `model_compat[]`, `evidence[{kind,url}]`, `published_by`, `published_at`, `use_count`, and `help_count`. Defaults for a minimal publish are human provenance, empty model_compat and evidence, null changelog, and zero use/help counts. Audit events record the publish actor alongside the digest.

## Practice

Keep the detected source (for example reckon for learned skills from a Reckon agent) so reviewers can prioritize evaluation. Mark bulk git intakes as import. Leave human for hand-written packages. Accurate provenance makes the delete-today board and audit trail meaningful when deciding what to age, retire, or keep active.
