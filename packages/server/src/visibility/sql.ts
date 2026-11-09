// SQL predicate equivalent to canView (visibility/index.ts).
import { roleAtLeast } from "../auth/users.ts";
import type { Viewer } from "./index.ts";

export type VisibleClause = { sql: string; params: string[] };

/**
 * SQL fragment (no leading AND/WHERE) true for rows the viewer may see.
 * table: SQL alias/name for the artifacts row (default "artifacts").
 */
export function visibleClause(viewer: Viewer, table = "artifacts"): VisibleClause {
  if (!viewer) {
    return {
      sql: "(" + table + ".purged_at IS NULL AND " + table + ".visibility <> 'team')",
      params: [],
    };
  }
  if (viewer.role === "admin") {
    return { sql: "(1 = 1)", params: [] };
  }
  if (roleAtLeast(viewer.role, "reviewer")) {
    return { sql: "(" + table + ".purged_at IS NULL)", params: [] };
  }
  const u = viewer.username;
  // org OR owner OR maintainer OR team member
  return {
    sql:
      "(" +
      table +
      ".purged_at IS NULL AND (" +
      table +
      ".visibility <> 'team' OR " +
      table +
      ".owner = ? OR EXISTS (SELECT 1 FROM artifact_maintainers am WHERE am.artifact_id = " +
      table +
      ".id AND am.username = ?) OR (" +
      table +
      ".owner_team IS NOT NULL AND EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.username = ? AND t.name = " +
      table +
      ".owner_team))))",
    params: [u, u, u],
  };
}
