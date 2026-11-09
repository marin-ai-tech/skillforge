import type { Database } from "../db.ts";
import type { ArtifactRow } from "../repo.ts";
import { roleAtLeast, type Role } from "../auth/users.ts";
import { isMaintainer } from "../ownership.ts";

export type Visibility = "org" | "team";

export type Viewer = { username: string; role: Role } | null;

/**
 * Single source of truth for artifact visibility.
 * `org` — visible to anyone who may read the registry (anonymous via PUBLIC_READ).
 * `team` — admin, reviewer+, owner, maintainer, or member of `owner_team`.
 * An anonymous user never sees a `team` artifact.
 */
export function canView(
  db: Database,
  user: Viewer,
  artifact: Pick<ArtifactRow, "id" | "visibility" | "owner_team" | "owner"> & {
    purged_at?: string | null;
  },
): boolean {
  const purged =
    artifact.purged_at === undefined
      ? (
          db.prepare("SELECT purged_at FROM artifacts WHERE id = ?").get(artifact.id) as
            { purged_at: string | null } | undefined
        )?.purged_at
      : artifact.purged_at;
  if (purged && user?.role !== "admin") return false;
  if (artifact.visibility !== "team") return true;
  if (!user) return false;
  if (roleAtLeast(user.role, "reviewer")) return true;
  if (user.username === artifact.owner) return true;
  if (isMaintainer(db, artifact.id, user.username)) return true;
  if (artifact.owner_team) {
    const row = db
      .prepare(
        `SELECT 1 AS n FROM team_members tm JOIN teams t ON t.id = tm.team_id
         WHERE tm.username = ? AND t.name = ?`,
      )
      .get(user.username, artifact.owner_team);
    if (row) return true;
  }
  return false;
}
