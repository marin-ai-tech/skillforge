import { bumpRegistryEpoch } from "./registry-epoch.ts";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { Database } from "./db.ts";
import { getUserByUsername, roleAtLeast, type Role } from "./auth/users.ts";

export type TeamsRoutesOpts = { db: Database };

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 40;
const MAX_MEMBERS = 500;
const ROLES = ["member", "lead"] as const;

export function isTeamName(value: string): boolean {
  return (
    typeof value === "string" && value.length > 0 && value.length <= MAX_NAME && NAME_RE.test(value)
  );
}

export type TeamRole = (typeof ROLES)[number];

export function isTeamRole(value: string): value is TeamRole {
  return (ROLES as readonly string[]).includes(value);
}

function teamId(): string {
  return randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

type TeamRow = {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  created_by: string;
  created_at: string;
};

export function getTeamByName(db: Database, name: string): TeamRow | undefined {
  return db.prepare("SELECT * FROM teams WHERE name = ?").get(name) as TeamRow | undefined;
}

export function isTeamMemberByUsername(db: Database, teamName: string, username: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS n FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE t.name = ? AND tm.username = ?`,
    )
    .get(teamName, username);
  return row !== undefined;
}

/** Role of `username` in team `teamName`, or null when not a member. */
export function teamRoleByUsername(
  db: Database,
  teamName: string,
  username: string,
): string | null {
  const row = db
    .prepare(
      `SELECT tm.role AS role FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE t.name = ? AND tm.username = ?`,
    )
    .get(teamName, username) as { role: string } | undefined;
  return row?.role ?? null;
}

function teamExists(db: Database, name: string): boolean {
  return getTeamByName(db, name) !== undefined;
}

function countMembers(db: Database, teamId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?")
    .get(teamId) as { n: number | bigint };
  return Number(row.n);
}

function listMembers(db: Database, teamId: string): Array<{ username: string; role: string }> {
  return db
    .prepare(
      "SELECT username, role FROM team_members WHERE team_id = ? ORDER BY username COLLATE NOCASE ASC",
    )
    .all(teamId) as Array<{ username: string; role: string }>;
}

function isMember(db: Database, teamId: string, username: string): boolean {
  const row = db
    .prepare("SELECT 1 AS n FROM team_members WHERE team_id = ? AND username = ?")
    .get(teamId, username);
  return row !== undefined;
}

function memberRole(db: Database, teamId: string, username: string): string | null {
  const row = db
    .prepare("SELECT role FROM team_members WHERE team_id = ? AND username = ?")
    .get(teamId, username) as { role: string } | undefined;
  return row?.role ?? null;
}

function appendTeamAudit(
  db: Database,
  input: {
    actor: string;
    team_id: string;
    action: string;
    meta?: Record<string, unknown> | null;
  },
): void {
  db.prepare(
    "INSERT INTO team_audit (ts, actor, team_id, action, meta) VALUES (?, ?, ?, ?, ?)",
  ).run(
    nowIso(),
    input.actor,
    input.team_id,
    input.action,
    input.meta ? JSON.stringify(input.meta) : null,
  );
}

/** Whether `actor` is a lead of the team, or admin. */
function isTeamLead(db: Database, teamId: string, username: string, role: Role): boolean {
  if (roleAtLeast(role, "admin")) return true;
  return memberRole(db, teamId, username) === "lead";
}

/** Active user + team role from a member add/update body; null → member_invalid. */
function parseMemberInput(
  db: Database,
  rawBody: unknown,
): { username: string; role: TeamRole } | null {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username : "";
  const user = getUserByUsername(db, username);
  if (!user || user.disabled !== 0) return null;
  const roleRaw = body.role === undefined ? "member" : body.role;
  if (typeof roleRaw !== "string" || !isTeamRole(roleRaw)) return null;
  return { username: user.username, role: roleRaw };
}

/** Insert a new member or change an existing member's role (audited), in one transaction. */
function writeMember(
  db: Database,
  m: { teamId: string; username: string; role: TeamRole; actor: string; existing: string | null },
): void {
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (m.existing === null) {
      db.prepare(
        "INSERT INTO team_members (team_id, username, role, added_by, added_at) VALUES (?, ?, ?, ?, ?)",
      ).run(m.teamId, m.username, m.role, m.actor, now);
      appendTeamAudit(db, {
        actor: m.actor,
        team_id: m.teamId,
        action: "member_add",
        meta: { username: m.username, role: m.role },
      });
    } else if (m.existing !== m.role) {
      db.prepare("UPDATE team_members SET role = ? WHERE team_id = ? AND username = ?").run(
        m.role,
        m.teamId,
        m.username,
      );
      appendTeamAudit(db, {
        actor: m.actor,
        team_id: m.teamId,
        action: "member_role",
        meta: { username: m.username, from: m.existing, to: m.role },
      });
    }
    bumpRegistryEpoch();
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    throw e;
  }
}

export const teamsRoutes: FastifyPluginAsync<TeamsRoutesOpts> = async (app, opts) => {
  const { db } = opts;

  app.post("/api/v1/teams", async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    if (!roleAtLeast(request.user.role, "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name : "";
    if (teamExists(db, name)) return reply.code(409).send({ error: "team_exists" });
    if (!isTeamName(name)) return reply.code(400).send({ error: "name_invalid" });
    const lead = typeof body.lead === "string" ? body.lead : "";
    const leadUser = getUserByUsername(db, lead);
    if (!leadUser || leadUser.disabled !== 0) {
      return reply.code(422).send({ error: "lead_invalid" });
    }
    const display_name = typeof body.display_name === "string" ? body.display_name : null;
    const description = typeof body.description === "string" ? body.description : null;
    const id = teamId();
    const now = nowIso();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO teams (id, name, display_name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, name, display_name, description, request.user.username, now);
      db.prepare(
        "INSERT INTO team_members (team_id, username, role, added_by, added_at) VALUES (?, ?, 'lead', ?, ?)",
      ).run(id, leadUser.username, request.user.username, now);
      bumpRegistryEpoch();
      appendTeamAudit(db, {
        actor: request.user.username,
        team_id: id,
        action: "team_created",
        meta: { name, lead: leadUser.username },
      });
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw e;
    }
    return reply.code(201).send({
      name,
      display_name,
      description,
      members: [{ username: leadUser.username, role: "lead" }],
    });
  });

  app.delete<{ Params: { name: string } }>("/api/v1/teams/:name", async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    if (!roleAtLeast(request.user.role, "admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const team = getTeamByName(db, request.params.name);
    if (!team) return reply.code(404).send({ error: "not_found" });
    const used = db.prepare("SELECT 1 AS n FROM artifacts WHERE owner_team = ?").get(team.name);
    if (used) return reply.code(409).send({ error: "team_in_use" });
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM team_members WHERE team_id = ?").run(team.id);
      db.prepare("DELETE FROM team_audit WHERE team_id = ?").run(team.id);
      db.prepare("DELETE FROM teams WHERE id = ?").run(team.id);
      bumpRegistryEpoch();
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw e;
    }
    return reply.code(200).send({ ok: true });
  });

  app.get("/api/v1/teams", async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    const isAdmin = roleAtLeast(request.user.role, "admin");
    const rows = db
      .prepare("SELECT * FROM teams ORDER BY name COLLATE NOCASE ASC")
      .all() as TeamRow[];
    const items = rows.map((t) => {
      const member = memberRole(db, t.id, request.user!.username);
      const showCount = isAdmin || member !== null;
      return {
        name: t.name,
        display_name: t.display_name,
        description: t.description,
        members_count: showCount ? countMembers(db, t.id) : null,
        is_member: member !== null,
      };
    });
    return reply.send({ items });
  });

  app.get<{ Params: { name: string } }>("/api/v1/teams/:name", async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    const team = getTeamByName(db, request.params.name);
    if (!team) return reply.code(404).send({ error: "not_found" });
    const member = memberRole(db, team.id, request.user.username);
    const isAdmin = roleAtLeast(request.user.role, "admin");
    const canSeeMembers = isAdmin || member !== null;
    return reply.send({
      name: team.name,
      display_name: team.display_name,
      description: team.description,
      created_by: team.created_by,
      created_at: team.created_at,
      members: canSeeMembers ? listMembers(db, team.id) : null,
      is_member: member !== null,
    });
  });

  app.post<{ Params: { name: string } }>("/api/v1/teams/:name/members", async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    const team = getTeamByName(db, request.params.name);
    if (!team) return reply.code(404).send({ error: "not_found" });
    const isAdmin = roleAtLeast(request.user.role, "admin");
    if (!isAdmin && !isMember(db, team.id, request.user.username)) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (!isTeamLead(db, team.id, request.user.username, request.user.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const input = parseMemberInput(db, request.body);
    if (!input) {
      return reply.code(422).send({ error: "member_invalid" });
    }
    const { username, role: roleRaw } = input;
    const existing = memberRole(db, team.id, username);
    if (existing === null && countMembers(db, team.id) >= MAX_MEMBERS) {
      return reply.code(409).send({ error: "team_full" });
    }
    writeMember(db, {
      teamId: team.id,
      username,
      role: roleRaw,
      actor: request.user.username,
      existing,
    });
    const isNew = existing === null;
    return reply.code(isNew ? 201 : 200).send({
      username,
      role: roleRaw,
    });
  });

  app.delete<{ Params: { name: string; username: string } }>(
    "/api/v1/teams/:name/members/:username",
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: "unauthorized" });
      const team = getTeamByName(db, request.params.name);
      if (!team) return reply.code(404).send({ error: "not_found" });
      const isAdmin = roleAtLeast(request.user.role, "admin");
      if (!isAdmin && !isMember(db, team.id, request.user.username)) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (!isTeamLead(db, team.id, request.user.username, request.user.role)) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const target = getUserByUsername(db, request.params.username);
      if (!target) return reply.code(404).send({ error: "not_found" });
      const targetRole = memberRole(db, team.id, target.username);
      if (targetRole === null) return reply.code(404).send({ error: "not_found" });
      if (targetRole === "lead" && countMembers(db, team.id) === 1) {
        return reply.code(409).send({ error: "last_lead" });
      }
      // Refuse to remove the last lead even when other members exist but none is a lead.
      if (targetRole === "lead") {
        const otherLead = db
          .prepare(
            "SELECT 1 AS n FROM team_members WHERE team_id = ? AND role = 'lead' AND username <> ?",
          )
          .get(team.id, target.username);
        if (!otherLead) return reply.code(409).send({ error: "last_lead" });
      }
      const now = nowIso();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM team_members WHERE team_id = ? AND username = ?").run(
          team.id,
          target.username,
        );
        bumpRegistryEpoch();
        void now;
        appendTeamAudit(db, {
          actor: request.user.username,
          team_id: team.id,
          action: "member_remove",
          meta: { username: target.username, role: targetRole },
        });
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ignore
        }
        throw e;
      }
      return reply.code(200).send({ ok: true });
    },
  );

  app.get<{ Params: { name: string } }>("/api/v1/teams/:name/audit", async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
    const team = getTeamByName(db, request.params.name);
    if (!team) return reply.code(404).send({ error: "not_found" });
    const isAdmin = roleAtLeast(request.user.role, "admin");
    if (!isAdmin && !isMember(db, team.id, request.user.username)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const rows = db
      .prepare(
        "SELECT ts, actor, action, meta FROM team_audit WHERE team_id = ? ORDER BY ts DESC, id DESC",
      )
      .all(team.id) as Array<{ ts: string; actor: string; action: string; meta: string | null }>;
    return reply.send({
      items: rows.map((r) => ({
        ts: r.ts,
        actor: r.actor,
        action: r.action,
        meta: r.meta ? JSON.parse(r.meta) : null,
      })),
    });
  });
};
