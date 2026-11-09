---
title: Starter packs
summary: How an administrator seeds an empty registry with the vendored starter packs — CodeAlive (nine skills) and the optional ECC essentials (three skills), all MIT — without network access.
section: start
learn:
  - Which skills the CodeAlive and ECC essentials packs contain
  - How to keep license and attribution intact
  - How an admin lists and installs the pack
  - Why installed skills arrive as candidate
related: getting-started/self-hosting, getting-started/lifecycle, getting-started/provenance, getting-started/roles, getting-started/quality, pages/users, actions/lifecycle/queue-promote
---

A fresh SkillForge registry is empty until someone publishes artifacts. Self-hosted teams often cannot reach GitHub from the server perimeter, so SkillForge ships **vendored starter packs**: nine MIT-licensed skills from CodeAlive-AI and three from affaan-m/ECC. Each pack is optional and installs on its own. The packs live on disk under `packages/server/starter-packs/` (`codealive/`, `ecc-essentials/`; override with `SKILLFORGE_STARTER_PACKS_DIR`) and are copied into the release archive and the runtime Docker image. Pack files are frozen at specific upstream commits recorded in `pack.json` and `NOTICE.md`; operators do not need network access during install.

## What is in the CodeAlive pack

The `codealive` pack includes: `settings-management`, `hooks-management`, `skills-management`, `prompt-engineering`, `pragmatic-orchestration`, `code-that-fits-in-your-head`, `bug-fix-protocol`, `plan-mode`, and `investigating-repository-history`. Skill directories are copied byte-for-byte from the upstream repositories (including `references/`, `scripts/`, and `prompts/` when present). SkillForge does not rewrite author text to pass validation; any validator findings are reported as deviations rather than silent edits.

## What is in the ECC essentials pack

The `ecc-essentials` pack includes `change-impact` (impact analysis before a risky change and a check of the diff against the plan), `architecture-decision-records` (decision records in `docs/adr/`) and `codebase-onboarding` (a guide to an unfamiliar repository). They were selected from eight candidates; the others were left out because of unsafe or wrong examples. Unlike CodeAlive, these skills are a SkillForge edition: references to ECC-only skills and agents are removed, `codebase-onboarding` writes the agent instructions file only on request, and every description says when not to use the skill. `NOTICE.md` lists each change under `Local changes`.

> [!NOTE]
> The benefit of the ECC essentials skills has not been measured with evals yet. Review them like any import before promoting them to `active`.

## License and attribution

All skills of both packs are MIT. Each pack root carries a full `LICENSE` text with the upstream copyright line and a `NOTICE.md` that names every skill, its repository (`CodeAlive-AI/ai-driven-development`, `CodeAlive-AI/pragmatic-orchestration` or `affaan-m/ECC`), source path, and the exact forty-character commit SHA.

> [!IMPORTANT]
> Keep those files when redistributing the image or the pack directory so attribution stays intact.

## How an administrator installs the pack

Only the `admin` role may list or install packs. Call `GET /api/v1/admin/starter-packs` to see available packs, artifact counts, and how many skills already match a published digest (`installed`). Call `POST /api/v1/admin/starter-packs/codealive/install` or `POST /api/v1/admin/starter-packs/ecc-essentials/install` to publish every skill of that pack through the shared publish pipeline; the other pack is not touched. The first-run page (`/start`) shows each pack in its own row with its own install button. Each skill is created as lifecycle status `candidate` with provenance `{ source: "import", ref: "<repo>@<commit>:<source_path>" }`. A second install is idempotent: matching digests return `exists` and do not create extra versions. Unknown pack ids and path-like `:id` values return `404`; contributors get `403`, anonymous callers `401`.

## Why skills arrive as candidate

Starter-pack install never bypasses the reviewer gate. Publishing as `candidate` keeps the same quality report, duplicate scan, and lifecycle rules that apply to human or import publishes. A reviewer promotes skills to `active` when the team is ready. That separation lets operators seed a useful catalog quickly without auto-trusting third-party content into production status.
