import type { Database } from "./repo.ts";
import { insertNotification } from "./notifications/notify.ts";

/**
 * Artifacts without a working owner: the owner's account is disabled or gone.
 * Retired and purged artifacts are left out: nobody needs to own them any more.
 */
export type Orphan = {
  type: string;
  name: string;
  owner: string;
  owner_state: "disabled" | "missing";
  maintainers: string[];
  suggested_owner: string | null;
};

const LIVE = "a.purged_at IS NULL AND a.status != 'retired'";

function activeMaintainers(db: Database, artifactId: string): string[] {
  return (
    db
      .prepare(
        `SELECT m.username FROM artifact_maintainers m JOIN users u ON u.username = m.username
         WHERE m.artifact_id = ? AND u.disabled = 0 ORDER BY m.username`,
      )
      .all(artifactId) as Array<{ username: string }>
  ).map((r) => r.username);
}

export function listOrphans(db: Database): Orphan[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.type, a.name, a.owner, u.disabled AS disabled FROM artifacts a
       LEFT JOIN users u ON u.username = a.owner
       WHERE ${LIVE} AND (u.id IS NULL OR u.disabled = 1)
       ORDER BY a.type, a.name`,
    )
    .all() as Array<{
    id: string;
    type: string;
    name: string;
    owner: string;
    disabled: number | null;
  }>;
  return rows.map((r) => {
    const maintainers = activeMaintainers(db, r.id);
    return {
      type: r.type,
      name: r.name,
      owner: r.owner,
      owner_state: r.disabled === null ? "missing" : "disabled",
      maintainers,
      suggested_owner: maintainers[0] ?? null,
    };
  });
}

/** When an owner is disabled, every active admin hears how many artifacts need a new owner. */
export function notifyOrphaned(db: Database, owner: string, actor: string): void {
  const { n } = db
    .prepare(`SELECT COUNT(*) AS n FROM artifacts a WHERE ${LIVE} AND a.owner = ?`)
    .get(owner) as { n: number };
  if (Number(n) === 0) return;
  const admins = db
    .prepare("SELECT username FROM users WHERE role = 'admin' AND disabled = 0")
    .all() as Array<{ username: string }>;
  for (const { username } of admins) {
    insertNotification(db, {
      username,
      kind: "ownership",
      actor,
      title: `${n} artifact(s) owned by ${owner} need a new owner`,
      url: "/admin/users#orphans",
      meta: { owner, count: Number(n) },
    });
  }
}
