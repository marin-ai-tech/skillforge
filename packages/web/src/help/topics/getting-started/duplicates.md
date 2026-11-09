---
title: Duplicates
summary: How SkillForge spots the same skill in several places, in the registry and in agent snapshots, and what to do with the extra copies.
section: publishing
learn:
  - Which duplicate kinds the registry reports
  - How snapshot duplicate groups are classified
  - Which copy SkillForge recommends keeping
  - What to do with replica, divergent and stale backup copies
related: getting-started/agents, getting-started/versions-and-digests, getting-started/artifact-types, pages/me-agent
---

The same skill often lives in more than one place: a copy in `.claude/skills` and another in `.agents/skills`, a forgotten `note.bak` folder, the same text published under a different name, or a reference file shared by several skills. SkillForge reports these situations in two places — in the registry when you validate or publish, and in an agent snapshot.

> [!NOTE]
> Reports are advisory only: nothing is blocked, and nothing is deleted for you.

## Duplicates in the registry

`POST /api/v1/artifacts/validate` and `POST /api/v1/artifacts` return a `duplicates` list, and `GET /api/v1/artifacts/:type/:name/duplicates` returns `items` for the latest version of a published artifact. The artifact is compared against the latest version of every other artifact that is not retired; the artifact itself (same type and name) is never reported. Each entry has `kind`, `type`, `name` and `detail`:

- `name_collision` — another artifact of a **different type** uses the same name (a skill and a command both called `release-notes`). `detail` is empty.
- `identical_body` — the main file (`SKILL.md`, `commands/<name>.md`, `agents/<name>.md` or `hooks/hooks.json`) has the same **body fingerprint**: the text without frontmatter, with line endings, trailing spaces and runs of blank lines normalised, hashed with SHA-256 and stored as `body_sha256` on the version. Whitespace-only edits therefore still count as identical.
- `shared_files` — a non-main file of at least 256 bytes has the same SHA-256 as a file in the other artifact. `detail.paths` lists up to five canonical paths of **your** artifact, such as `skills/gamma-writer/references/GUIDE.md`.
- `similar_description` — the descriptions share most of their words. Words are lower-cased, reduced to letters and digits, shorter than three characters and common stop words are dropped, and the Jaccard coefficient of the two sets must be at least 0.6. `detail.score` is rounded to two decimals.

Entries are ordered by kind in the order above, then by type and name.

## Duplicates in an agent snapshot

When one `type/name` key is found under several roots, the snapshot keeps **one** item and describes the rest in `duplicates`, returned by `PUT`, `GET` and rescan of `/api/v1/me/agents/:name`. Every group has `key`, `class`, `roots` (each with `root` and `digest`, sorted by root), `keep` and a short `reason`:

- `replica` — all copies have the same digest; they are interchangeable.
- `divergent` — the copies differ; review the changes before removing any of them.
- `stale_backup` — at least one root ends with a backup suffix (`.bak`, `.old`, `.orig`, `.backup`, `-backup`, `-old`, `~`). This class wins over the other two.

`keep` names the recommended source. A backup copy is never recommended while a normal copy exists. Otherwise roots are ranked: `.claude/…` first, then roots without a leading dot (`skills/…`), then `.agents/…`, then everything else; ties are broken alphabetically. The kept copy is the one stored in the snapshot, compared with the registry and offered for publishing.

## What to do with the other copies

For a `replica`, delete the extra copies or turn them into a single installed location. For a `divergent` group, diff the copies, merge what you need into the kept root and remove the rest — or publish the kept one and reinstall it elsewhere. For a `stale_backup`, delete the backup folder once you have confirmed the current copy is correct. In the registry, `identical_body` and `similar_description` usually mean one of the artifacts should be retired; `shared_files` is a hint to extract common material, and `name_collision` is a reminder to pick distinct names across artifact types.

> [!WARNING]
> Diff a `divergent` copy against the kept root before you delete it: changes that exist only in that copy are lost otherwise.
