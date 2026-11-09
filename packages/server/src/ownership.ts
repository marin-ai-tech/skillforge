import { bumpRegistryEpoch } from "./registry-epoch.ts";
import type { Database } from "./repo.ts";
import { getUserByUsername, roleAtLeast, type Role } from "./auth/users.ts";

export type PublishRight =
  { allowed: true; override: boolean; owner: string } | { allowed: false; owner: string };

/** Whether `actor` may publish a new version of an existing artifact. */
export function canPublishVersion(
  db: Database,
  actor: string,
  role: Role,
  artifact: { id: string; owner: string },
): PublishRight {
  if (actor === artifact.owner) {
    return { allowed: true, override: false, owner: artifact.owner };
  }
  if (isMaintainer(db, artifact.id, actor)) {
    return { allowed: true, override: false, owner: artifact.owner };
  }
  if (roleAtLeast(role, "reviewer")) {
    return { allowed: true, override: true, owner: artifact.owner };
  }
  return { allowed: false, owner: artifact.owner };
}

export function isMaintainer(db: Database, artifactId: string, username: string): boolean {
  const row = db
    .prepare("SELECT 1 AS n FROM artifact_maintainers WHERE artifact_id = ? AND username = ?")
    .get(artifactId, username);
  return row !== undefined;
}

export function listMaintainers(db: Database, artifactId: string): string[] {
  const rows = db
    .prepare(
      "SELECT username FROM artifact_maintainers WHERE artifact_id = ? ORDER BY username COLLATE NOCASE ASC",
    )
    .all(artifactId) as Array<{ username: string }>;
  return rows.map((r) => r.username);
}

export function addMaintainer(
  db: Database,
  artifactId: string,
  username: string,
  addedBy: string,
  now: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO artifact_maintainers (artifact_id, username, added_by, added_at)
     VALUES (?, ?, ?, ?)`,
  ).run(artifactId, username, addedBy, now);
  bumpRegistryEpoch();
}

export function removeMaintainer(db: Database, artifactId: string, username: string): boolean {
  const result = db
    .prepare("DELETE FROM artifact_maintainers WHERE artifact_id = ? AND username = ?")
    .run(artifactId, username);
  bumpRegistryEpoch();
  return result.changes > 0;
}

export type ManageRecheck =
  | { ok: true; owner: string }
  | { ok: false; status: 403 | 404 | 409; error: "forbidden" | "not_found" | "owner_changed" };

/**
 * Re-check the right to manage ownership/maintainers (owner or admin) against the artifact
 * row re-read inside the caller's `BEGIN IMMEDIATE` transaction. `seenOwner` is the
 * owner observed before the transaction: if another process changed it in between, the
 * request is stale and must not write (`409 owner_changed`). Synchronous: no await while
 * the transaction is open.
 */
export function recheckManageRight(
  db: Database,
  artifactId: string,
  seenOwner: string,
  user: { username: string; role: Role },
): ManageRecheck {
  const fresh = db.prepare("SELECT owner FROM artifacts WHERE id = ?").get(artifactId) as
    { owner: string } | undefined;
  if (!fresh) return { ok: false, status: 404, error: "not_found" };
  if (fresh.owner !== seenOwner) return { ok: false, status: 409, error: "owner_changed" };
  if (user.username !== fresh.owner && !roleAtLeast(user.role, "admin")) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, owner: fresh.owner };
}

export type RecipientCheck = { ok: true; username: string } | { ok: false };

/** Resolve a request username to the canonical users.username, requiring an enabled user with role >= contributor. */
export function resolveRecipient(db: Database, username: string): RecipientCheck {
  const user = getUserByUsername(db, username);
  if (!user || user.disabled !== 0 || !roleAtLeast(user.role, "contributor")) {
    return { ok: false };
  }
  return { ok: true, username: user.username };
}
