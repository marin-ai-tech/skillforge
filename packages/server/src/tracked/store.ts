import type { Database } from "../repo.ts";
import type { SourceEdit } from "./edits.ts";

/**
 * Tracked sources (tracked-sources): one row per artifact that came from git. Created from the provenance of a
 * version — `import:<url>@<sha40>:<path>` or the starter-pack form `<owner>/<repo>@<sha40>:<path>` (GitHub) — when
 * the artifact has none yet; the check moves `last_commit` and `state` on.
 */
export type SourceState =
  "ok" | "unchanged" | "quarantined" | "failed" | "edits_outdated" | "path_missing";

export type TrackedSource = {
  artifact_id: string;
  url: string;
  path: string;
  ref: string | null;
  last_commit: string | null;
  last_checked_at: string | null;
  state: SourceState | null;
  state_detail: string | null;
  enabled: boolean;
  edits: SourceEdit[];
};

type Row = Omit<TrackedSource, "enabled" | "edits"> & { enabled: number; edits: string };

const REF_RE = /^(.+)@([0-9a-f]{40}):(.*)$/;
const SHORT_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** URL, commit and path of an import provenance ref, or null when it does not name a git source. */
export function parseSourceRef(
  ref: string | null,
): { url: string; sha: string; path: string } | null {
  const m = ref ? REF_RE.exec(ref) : null;
  if (!m) return null;
  const [, where, sha, path] = m as unknown as [string, string, string, string];
  const url = SHORT_RE.test(where) ? `https://github.com/${where}` : where;
  if (!/^https:\/\//.test(url) || path.split("/").some((s) => s === "..")) return null;
  return { url, sha, path: path.replace(/^\/|\/$/g, "") };
}

function toSource(row: Row): TrackedSource {
  return { ...row, enabled: row.enabled === 1, edits: JSON.parse(row.edits) as SourceEdit[] };
}

export function getSource(db: Database, artifactId: string): TrackedSource | null {
  const row = db.prepare("SELECT * FROM artifact_sources WHERE artifact_id = ?").get(artifactId) as
    Row | undefined;
  return row ? toSource(row) : null;
}

export function listEnabledSources(db: Database): TrackedSource[] {
  return (
    db
      .prepare("SELECT * FROM artifact_sources WHERE enabled = 1 ORDER BY created_at")
      .all() as Row[]
  ).map(toSource);
}

/** Latest version's provenance of an artifact. */
function latestProvenance(
  db: Database,
  artifactId: string,
): { source: string; ref: string | null } | null {
  const row = db
    .prepare(
      `SELECT v.provenance FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
       WHERE a.id = ? AND v.version = a.latest_version`,
    )
    .get(artifactId) as { provenance: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.provenance) as { source: string; ref: string | null };
  } catch {
    return null;
  }
}

/** A source for the artifact from its latest version, when it came from git and has no source yet. */
export function ensureSourceForArtifact(db: Database, artifactId: string): TrackedSource | null {
  const existing = getSource(db, artifactId);
  if (existing) return existing;
  const p = latestProvenance(db, artifactId);
  const parsed = p?.source === "import" ? parseSourceRef(p.ref) : null;
  if (!parsed) return null;
  db.prepare(
    `INSERT INTO artifact_sources (artifact_id, url, path, last_commit, created_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(artifact_id) DO NOTHING`,
  ).run(artifactId, parsed.url, parsed.path, parsed.sha, new Date().toISOString());
  return getSource(db, artifactId);
}

/** Sources for artifacts that came from git before this feature (run at start; idempotent). */
export function backfillSources(db: Database): void {
  const ids = db
    .prepare(
      `SELECT a.id FROM artifacts a LEFT JOIN artifact_sources s ON s.artifact_id = a.id
       WHERE s.artifact_id IS NULL AND a.purged_at IS NULL`,
    )
    .all() as Array<{ id: string }>;
  for (const { id } of ids) ensureSourceForArtifact(db, id);
}

export function updateSource(
  db: Database,
  artifactId: string,
  patch: { enabled?: boolean; ref?: string | null; edits?: SourceEdit[] },
): void {
  if (patch.enabled !== undefined)
    db.prepare("UPDATE artifact_sources SET enabled = ? WHERE artifact_id = ?").run(
      patch.enabled ? 1 : 0,
      artifactId,
    );
  if (patch.ref !== undefined)
    db.prepare("UPDATE artifact_sources SET ref = ? WHERE artifact_id = ?").run(
      patch.ref,
      artifactId,
    );
  if (patch.edits !== undefined)
    db.prepare("UPDATE artifact_sources SET edits = ? WHERE artifact_id = ?").run(
      JSON.stringify(patch.edits),
      artifactId,
    );
}

/** Starter packs bring their local changes: set them when the source has none yet. */
export function setEditsIfEmpty(db: Database, artifactId: string, edits: SourceEdit[]): void {
  db.prepare("UPDATE artifact_sources SET edits = ? WHERE artifact_id = ? AND edits = '[]'").run(
    JSON.stringify(edits),
    artifactId,
  );
}

export function saveCheck(
  db: Database,
  artifactId: string,
  result: { state: SourceState; detail?: string | null; commit?: string | null },
): void {
  db.prepare(
    `UPDATE artifact_sources SET state = ?, state_detail = ?, last_checked_at = ?,
       last_commit = COALESCE(?, last_commit) WHERE artifact_id = ?`,
  ).run(
    result.state,
    result.detail ?? null,
    new Date().toISOString(),
    result.commit ?? null,
    artifactId,
  );
}
