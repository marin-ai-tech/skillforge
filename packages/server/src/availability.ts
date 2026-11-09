import type { Database } from "./repo.ts";
import { appendAudit, getArtifactByTypeName } from "./repo.ts";
import { getTeamByName, teamRoleByUsername } from "./teams.ts";
import { canView, type Viewer } from "./visibility/index.ts";

/**
 * Availability of an artifact per team: unavailable, available (no row), installed
 * by default, or required. A person in several teams gets the most permissive state, as in Claude's admin model.
 * This guides installation; it is not access control: hiding an artifact is the team visibility's job.
 */
export const STATES = ["unavailable", "available", "default", "required"] as const;
export type AvailabilityState = (typeof STATES)[number];

const RANK: Record<AvailabilityState, number> = {
  unavailable: 0,
  available: 1,
  default: 2,
  required: 3,
};

export class AvailabilityError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function listAvailability(db: Database, artifactId: string) {
  return db
    .prepare(
      `SELECT t.name AS team, a.state AS state FROM artifact_availability a
       JOIN teams t ON t.id = a.team_id WHERE a.artifact_id = ? ORDER BY t.name`,
    )
    .all(artifactId) as Array<{ team: string; state: AvailabilityState }>;
}

/** Admins set it for any team, a team lead for their own team; `available` removes the row. */
export function setAvailability(
  db: Database,
  actor: { username: string; role: string },
  artifact: { type: string; name: string },
  body: unknown,
): void {
  const b = (body ?? {}) as Record<string, unknown>;
  const state = b.state as AvailabilityState;
  if (typeof b.team !== "string" || !(STATES as readonly string[]).includes(state)) {
    throw new AvailabilityError(400, "bad_request");
  }
  const team = getTeamByName(db, b.team);
  if (!team) throw new AvailabilityError(422, "team_unknown");
  if (actor.role !== "admin" && teamRoleByUsername(db, team.name, actor.username) !== "lead") {
    throw new AvailabilityError(403, "forbidden");
  }
  const row = getArtifactByTypeName(db, artifact.type, artifact.name)!;
  const now = new Date().toISOString();
  if (state === "available") {
    db.prepare("DELETE FROM artifact_availability WHERE artifact_id = ? AND team_id = ?").run(
      row.id,
      team.id,
    );
  } else {
    db.prepare(
      `INSERT INTO artifact_availability (artifact_id, team_id, state, set_by, set_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(artifact_id, team_id) DO UPDATE SET state = excluded.state, set_by = excluded.set_by, set_at = excluded.set_at`,
    ).run(row.id, team.id, state, actor.username, now);
  }
  appendAudit(db, {
    ts: now,
    actor: actor.username,
    artifact_id: row.id,
    version: null,
    action: "availability_set",
    meta: { team: team.name, state },
  });
}

type Assigned = { type: string; name: string; team: string };

/** What a person must, should or may not install, from all their teams together. */
export function assignmentsFor(db: Database, viewer: Viewer & { username: string }) {
  const teams = (
    db
      .prepare(
        `SELECT t.id, t.name FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.username = ?`,
      )
      .all(viewer.username) as Array<{ id: string; name: string }>
  ).map((t) => t);
  const out = {
    required: [] as Assigned[],
    default: [] as Assigned[],
    unavailable: [] as Assigned[],
  };
  if (teams.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT a.artifact_id, a.team_id, a.state, x.type, x.name FROM artifact_availability a
       JOIN artifacts x ON x.id = a.artifact_id
       WHERE a.team_id IN (${teams.map(() => "?").join(",")}) AND x.status = 'active' AND x.purged_at IS NULL`,
    )
    .all(...teams.map((t) => t.id)) as Array<{
    artifact_id: string;
    team_id: string;
    state: AvailabilityState;
    type: string;
    name: string;
  }>;
  const best = new Map<
    string,
    { state: AvailabilityState; row: (typeof rows)[number]; seen: number }
  >();
  for (const r of rows) {
    const cur = best.get(r.artifact_id);
    const seen = (cur?.seen ?? 0) + 1;
    if (!cur || RANK[r.state] > RANK[cur.state])
      best.set(r.artifact_id, { state: r.state, row: r, seen });
    else cur.seen = seen;
  }
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  for (const { state, row, seen } of best.values()) {
    // A team without a row counts as "available", which beats "unavailable".
    const effective = state === "unavailable" && seen < teams.length ? "available" : state;
    if (effective === "available") continue;
    const art = getArtifactByTypeName(db, row.type, row.name);
    if (!art || !canView(db, viewer, art)) continue;
    out[effective].push({ type: row.type, name: row.name, team: teamName.get(row.team_id) ?? "" });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
