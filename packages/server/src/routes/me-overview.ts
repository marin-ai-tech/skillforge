import type { FastifyPluginAsync } from "fastify";
import { requireUser } from "../auth/guard.ts";
import { roleAtLeast } from "../auth/users.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { rowToSummary, type ArtifactRow } from "../repo.ts";
import { userSessionsSummary } from "../sessions/facts.ts";
import { buildMyAgentsList } from "../agents/my-list.ts";
import { visibleUnreadCount } from "../notifications/notify.ts";
import { visibleClause } from "../visibility/sql.ts";
import { canView } from "../visibility/index.ts";

export type MeOverviewPluginOpts = {
  db: Database;
  config: AppConfig;
};

const STATUSES = ["candidate", "active", "aging", "zombie", "retired"] as const;

export const meOverviewRoutes: FastifyPluginAsync<MeOverviewPluginOpts> = async (app, opts) => {
  const { db } = opts;

  app.get("/api/v1/me/overview", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const user = request.user!;
    const username = user.username;

    const artifactRows = db
      .prepare(
        `SELECT * FROM artifacts
         WHERE owner = ?
         ORDER BY updated_at DESC, name ASC
         LIMIT 50`,
      )
      .all(username) as ArtifactRow[];
    const totalRow = db
      .prepare("SELECT COUNT(*) AS n FROM artifacts WHERE owner = ?")
      .get(username) as { n: number | bigint };
    const total = Number(totalRow.n);

    const byStatus: Record<string, number> = {};
    for (const s of STATUSES) byStatus[s] = 0;
    const statusRows = db
      .prepare(
        `SELECT status, COUNT(*) AS n FROM artifacts
         WHERE owner = ?
         GROUP BY status`,
      )
      .all(username) as Array<{ status: string; n: number | bigint }>;
    for (const r of statusRows) {
      if (r.status in byStatus) byStatus[r.status] = Number(r.n);
    }

    const viewer = { username: user.username, role: user.role };
    const agentItems = buildMyAgentsList(db, user.id, viewer);
    const attention = agentItems.filter((a) => a.summary.outdated + a.summary.modified > 0).length;
    const agentsOut = agentItems.map((a) => ({
      name: a.name,
      kind: a.kind,
      runtime: a.runtime,
      scanned_at: a.scanned_at,
      summary: a.summary,
    }));

    const tokenStats = db
      .prepare(
        `SELECT
           COUNT(*) AS active,
           SUM(CASE WHEN last_used_at IS NULL THEN 1 ELSE 0 END) AS never_used,
           MAX(last_used_at) AS last_used_at
         FROM api_tokens
         WHERE user_id = ? AND revoked_at IS NULL`,
      )
      .get(user.id) as {
      active: number | bigint;
      never_used: number | bigint | null;
      last_used_at: string | null;
    };

    let review: {
      pending: number;
      items: ReturnType<typeof rowToSummary>[];
    } | null = null;
    if (roleAtLeast(user.role, "reviewer")) {
      const vis = visibleClause(viewer, "artifacts");
      const pendingRow = db
        .prepare(`SELECT COUNT(*) AS n FROM artifacts WHERE status = 'candidate' AND ${vis.sql}`)
        .get(...vis.params) as { n: number | bigint };
      const reviewRows = db
        .prepare(
          `SELECT * FROM artifacts
           WHERE status = 'candidate' AND ${vis.sql}
           ORDER BY created_at ASC, name ASC
           LIMIT 10`,
        )
        .all(...vis.params) as ArtifactRow[];
      review = {
        pending: Number(pendingRow.n),
        items: reviewRows.map((r) => rowToSummary(db, r)),
      };
    }

    const activityRows = db
      .prepare(
        `SELECT
           ae.ts AS ts,
           ae.actor AS actor,
           ae.action AS action,
           ae.version AS version,
           ae.from_status AS from_status,
           ae.to_status AS to_status,
           ae.reason AS reason,
           a.type AS type,
           a.name AS name
         FROM audit_events ae
         JOIN artifacts a ON a.id = ae.artifact_id
         WHERE ae.actor = ? OR a.owner = ?
         ORDER BY ae.ts DESC, ae.id DESC
         LIMIT 20`,
      )
      .all(username, username) as Array<{
      ts: string;
      actor: string;
      action: string;
      version: string | null;
      from_status: string | null;
      to_status: string | null;
      reason: string | null;
      type: string;
      name: string;
    }>;

    return reply.code(200).send({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
      },
      artifacts: {
        total,
        by_status: byStatus,
        items: artifactRows.map((r) => rowToSummary(db, r)),
      },
      agents: {
        total: agentsOut.length,
        attention,
        items: agentsOut,
      },
      tokens: {
        active: Number(tokenStats.active),
        never_used: Number(tokenStats.never_used ?? 0),
        last_used_at: tokenStats.last_used_at ?? null,
      },
      review,
      activity: activityRows.filter((ev) => {
        const row = db
          .prepare(
            "SELECT id, visibility, owner_team, owner FROM artifacts WHERE type = ? AND name = ?",
          )
          .get(ev.type, ev.name) as
          { id: string; visibility: string; owner_team: string | null; owner: string } | undefined;
        return row ? canView(db, viewer, row) : false;
      }),
      sessions: userSessionsSummary(db, username),
      notifications: { unread: visibleUnreadCount(db, username, user.role) },
    });
  });
};
