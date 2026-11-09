import type { Role } from "./auth/users.ts";
import { canPublishVersion } from "./ownership.ts";
import { appendAudit, getArtifactByTypeName, type ArtifactRow, type Database } from "./repo.ts";

/**
 * "Replaced by": points an outdated artifact at its successor so the
 * catalog and `skillforge sync` can move people over. Set by whoever may publish versions of the artifact.
 */
export class ReplacementError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

const KEY_RE = /^([a-z]+)\/([a-z0-9][a-z0-9-]{0,63})$/;
const MAX_CHAIN = 20;

function parseTarget(raw: unknown): { type: string; name: string } | null {
  if (raw === null) return null;
  const m = typeof raw === "string" ? KEY_RE.exec(raw) : null;
  if (!m) throw new ReplacementError(400, "bad_request", "replaced_by must be type/name or null");
  return { type: m[1]!, name: m[2]! };
}

/** Following the successor's own chain must not lead back here. */
function makesCycle(db: Database, row: ArtifactRow, target: ArtifactRow): boolean {
  let current: ArtifactRow | undefined = target;
  for (let i = 0; current && i < MAX_CHAIN; i++) {
    if (current.id === row.id) return true;
    const next = parseTarget(current.replaced_by ?? null);
    current = next ? getArtifactByTypeName(db, next.type, next.name) : undefined;
  }
  return false;
}

function checkTarget(db: Database, row: ArtifactRow, target: { type: string; name: string }) {
  const found = getArtifactByTypeName(db, target.type, target.name);
  const invalid = (message: string) => new ReplacementError(422, "replacement_invalid", message);
  if (!found || found.purged_at) throw invalid("successor not found");
  if (found.type !== row.type) throw invalid("successor must have the same type");
  if (found.id === row.id) throw invalid("an artifact cannot replace itself");
  if (makesCycle(db, row, found)) throw invalid("successors would form a cycle");
}

export function setReplacement(
  db: Database,
  actor: { username: string; role: Role },
  row: ArtifactRow,
  body: unknown,
): string | null {
  if (!canPublishVersion(db, actor.username, actor.role, row).allowed) {
    throw new ReplacementError(403, "forbidden");
  }
  const target = parseTarget((body as Record<string, unknown> | null)?.replaced_by ?? null);
  if (target) checkTarget(db, row, target);
  const value = target ? `${target.type}/${target.name}` : null;
  const now = new Date().toISOString();
  db.prepare("UPDATE artifacts SET replaced_by = ?, updated_at = ? WHERE id = ?").run(
    value,
    now,
    row.id,
  );
  appendAudit(db, {
    ts: now,
    actor: actor.username,
    artifact_id: row.id,
    version: null,
    action: "replacement_set",
    meta: { replaced_by: value },
  });
  return value;
}
