import type { FastifyPluginAsync } from "fastify";
import type { Database } from "../db.ts";
import { requireUser } from "../auth/guard.ts";
import { getArtifactById } from "../repo.ts";
import { canView } from "../visibility/index.ts";
import { preferenceEnabled, visibleUnreadCount } from "../notifications/notify.ts";

const kinds = ["comment", "mention", "new_version", "status_change", "plugin"] as const;
type Row = {
  id: string;
  kind: string;
  artifact_id: string | null;
  version: string | null;
  comment_id: string | null;
  actor: string | null;
  title: string;
  text: string | null;
  url: string;
  created_at: string;
  read_at: string | null;
};

type Reader = { viewer: Parameters<typeof canView>[1]; username: string };

/** Notifications about an artifact the reader can no longer see are left untouched. */
function notificationVisible(db: Database, artifactId: string | null, reader: Reader): boolean {
  const a = artifactId ? getArtifactById(db, artifactId) : null;
  return !(artifactId && (!a || !canView(db, reader.viewer, a)));
}

function markRead(db: Database, id: string, username: string, now: string): number {
  return Number(
    db
      .prepare(
        "UPDATE notifications SET read_at = ? WHERE id = ? AND username = ? AND read_at IS NULL",
      )
      .run(now, id, username).changes,
  );
}

function isIdList(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length <= 500 && ids.every((id) => typeof id === "string");
}

function markAllRead(db: Database, reader: Reader, now: string): number {
  let updated = 0;
  const rows = db
    .prepare("SELECT id, artifact_id FROM notifications WHERE username = ? AND read_at IS NULL")
    .all(reader.username) as Array<{ id: string; artifact_id: string | null }>;
  for (const n of rows) {
    if (!notificationVisible(db, n.artifact_id, reader)) continue;
    updated += markRead(db, n.id, reader.username, now);
  }
  return updated;
}

function markIdsRead(db: Database, reader: Reader, ids: string[], now: string): number {
  let updated = 0;
  for (const id of new Set(ids)) {
    const n = db
      .prepare("SELECT artifact_id FROM notifications WHERE id = ? AND username = ?")
      .get(id, reader.username) as { artifact_id: string | null } | undefined;
    if (!n) continue;
    if (!notificationVisible(db, n.artifact_id, reader)) continue;
    updated += markRead(db, id, reader.username, now);
  }
  return updated;
}

export const notificationsRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get<{ Querystring: { unread?: string; limit?: string; cursor?: string } }>(
    "/api/v1/me/notifications",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const { username, role } = request.user;
      const q = request.query;
      const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
      const rows = db
        .prepare(
          `SELECT * FROM notifications WHERE username = ?
        AND (? <> '1' OR read_at IS NULL)
        ORDER BY created_at DESC, rowid DESC`,
        )
        .all(username, q.unread ?? "0") as Row[];
      const visible = rows.filter((n) => {
        if (!n.artifact_id) return true;
        const a = getArtifactById(db, n.artifact_id);
        return a && canView(db, { username, role }, a);
      });
      const start = q.cursor ? visible.findIndex((n) => n.id === q.cursor) + 1 : 0;
      const page = visible.slice(start, start + limit);
      const items = page.map((n) => {
        const a = n.artifact_id ? getArtifactById(db, n.artifact_id) : null;
        return {
          id: n.id,
          kind: n.kind,
          artifact: a ? { type: a.type, name: a.name } : null,
          version: n.version,
          comment_id: n.comment_id,
          actor: n.actor,
          title: n.title,
          text: n.text,
          url: n.url,
          created_at: n.created_at,
          read: n.read_at !== null,
        };
      });
      return reply.send({
        items,
        unread_count: visibleUnreadCount(db, username, role),
        next_cursor: visible.length > start + limit ? items.at(-1)?.id : null,
      });
    },
  );

  app.post("/api/v1/me/notifications/read", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const body = (request.body ?? {}) as { all?: unknown; ids?: unknown };
    const now = new Date().toISOString();
    const reader = { viewer: request.user, username: request.user.username };
    if (body.all === true) {
      return reply.send({ updated: markAllRead(db, reader, now) });
    }
    if (!isIdList(body.ids)) return reply.code(400).send({ error: "bad_request" });
    return reply.send({ updated: markIdsRead(db, reader, body.ids, now) });
  });

  app.get("/api/v1/me/notification-prefs", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return reply.send(
      Object.fromEntries(
        kinds.map((kind) => [kind, preferenceEnabled(db, request.user.username, kind)]),
      ),
    );
  });
  app.put("/api/v1/me/notification-prefs", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (
      body.mention === false ||
      Object.entries(body).some(
        ([kind, enabled]) =>
          !kinds.includes(kind as (typeof kinds)[number]) || typeof enabled !== "boolean",
      )
    )
      return reply.code(400).send({ error: "bad_request" });
    for (const [kind, enabled] of Object.entries(body))
      db.prepare(
        `INSERT INTO notification_prefs
      (username, kind, enabled) VALUES (?, ?, ?) ON CONFLICT (username, kind) DO UPDATE SET enabled = excluded.enabled`,
      ).run(request.user.username, kind, enabled ? 1 : 0);
    return reply.send(
      Object.fromEntries(
        kinds.map((kind) => [kind, preferenceEnabled(db, request.user.username, kind)]),
      ),
    );
  });
};
