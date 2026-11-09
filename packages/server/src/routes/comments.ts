import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { Database } from "../db.ts";
import { requireUser } from "../auth/guard.ts";
import { roleAtLeast } from "../auth/users.ts";
import {
  appendAudit,
  getArtifactById,
  getArtifactByTypeName,
  getVersion,
  type ArtifactRow,
} from "../repo.ts";
import { canView } from "../visibility/index.ts";
import { notify, emitNotifications } from "../notifications/notify.ts";
import { emitPluginEvent } from "../plugins/events.ts";

type Comment = {
  id: string;
  artifact_id: string;
  version: string | null;
  parent_id: string | null;
  author: string;
  body: string;
  ref: string | null;
  mentions: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};
const validBody = (v: unknown): v is string =>
  typeof v === "string" && v.length >= 1 && v.length <= 4000 && !v.includes("\0");
const parsed = (c: Comment) => ({
  id: c.id,
  version: c.version,
  parent_id: c.parent_id,
  author: c.author,
  body: c.body,
  ref: c.ref,
  mentions: JSON.parse(c.mentions) as string[],
  created_at: c.created_at,
  edited_at: c.edited_at,
  deleted: c.deleted_at !== null,
});
function mentions(db: Database, body: string, artifact: ArtifactRow): string[] {
  const result: string[] = [];
  const re = /(?<![\p{L}\p{N}@])@([a-z0-9][a-z0-9_.-]{0,38})/gu;
  for (const match of body.matchAll(re)) {
    const name = match[1]!;
    if (result.includes(name)) continue;
    const user = db
      .prepare("SELECT username, role, disabled FROM users WHERE username = ?")
      .get(name) as { username: string; role: "viewer"; disabled: number } | undefined;
    if (user && !user.disabled && canView(db, user, artifact)) result.push(user.username);
    if (result.length >= 10) break;
  }
  return result;
}

type NewCommentInput = {
  text: string;
  ref: string | null;
  version: string | null;
  parentId: string | undefined;
};

function commentShapeValid(body: Record<string, unknown>): boolean {
  return (
    validBody(body.body) &&
    (body.ref === undefined || (typeof body.ref === "string" && body.ref.length <= 128)) &&
    (body.version === undefined || typeof body.version === "string") &&
    (body.parent_id === undefined || typeof body.parent_id === "string")
  );
}

/** 400 = malformed body; 404 = empty version / parent_id (nothing can match them). */
function parseNewComment(
  raw: unknown,
): { ok: true; value: NewCommentInput } | { ok: false; status: 400 | 404 } {
  const body = (raw ?? {}) as Record<string, unknown>;
  if (!commentShapeValid(body)) return { ok: false, status: 400 };
  if (body.version === "" || body.parent_id === "") return { ok: false, status: 404 };
  return {
    ok: true,
    value: {
      text: body.body as string,
      ref: (body.ref as string | undefined) ?? null,
      version: (body.version ?? null) as string | null,
      parentId: body.parent_id as string | undefined,
    },
  };
}

/** Thread root for a reply (a reply to a reply attaches to its root); null = parent not found. */
function resolveThreadParent(
  db: Database,
  parentId: string | undefined,
  artifactId: string,
): { parent: Comment | undefined } | null {
  if (!parentId) return { parent: undefined };
  const parent = db
    .prepare("SELECT * FROM comments WHERE id = ? AND artifact_id = ?")
    .get(parentId, artifactId) as Comment | undefined;
  if (!parent) return null;
  if (!parent.parent_id) return { parent };
  return {
    parent: db.prepare("SELECT * FROM comments WHERE id = ?").get(parent.parent_id) as Comment,
  };
}

type InsertCommentArgs = {
  id: string;
  now: string;
  username: string;
  artifact: ArtifactRow;
  version: string | null;
  parent: Comment | undefined;
  text: string;
  ref: string | null;
};

function insertCommentTx(
  db: Database,
  args: InsertCommentArgs,
): { ok: false } | { ok: true; comment: Comment; created: ReturnType<typeof notify> } {
  const { id, now, username, artifact: a, version, parent } = args;
  db.exec("BEGIN IMMEDIATE");
  try {
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM comments WHERE author = ? AND created_at >= ?")
      .get(username, new Date(Date.now() - 3600000).toISOString()) as {
      n: number;
    };
    if (count.n >= 30) {
      db.exec("ROLLBACK");
      return { ok: false };
    }
    const accepted = mentions(db, args.text, a);
    db.prepare(
      `INSERT INTO comments (id, artifact_id, version, parent_id, author, body, ref, mentions, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      a.id,
      version,
      parent?.id ?? null,
      username,
      args.text,
      args.ref,
      JSON.stringify(accepted),
      now,
    );
    db.prepare(
      "INSERT INTO artifact_watchers (artifact_id, username, source) VALUES (?, ?, 'auto') ON CONFLICT DO NOTHING",
    ).run(a.id, username);
    const created = notify(db, {
      kind: "comment",
      artifact: a,
      actor: username,
      version,
      commentId: id,
      parentId: parent?.id,
      mentions: accepted,
    });
    const c = db.prepare("SELECT * FROM comments WHERE id = ?").get(id) as Comment;
    db.exec("COMMIT");
    return { ok: true, comment: c, created };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function emitCommentCreated(
  a: ArtifactRow,
  c: Comment,
  version: string | null,
  parent: Comment | undefined,
  now: string,
): void {
  emitPluginEvent({
    type: "comment.created",
    at: now,
    comment: {
      id: c.id,
      artifact: { type: a.type, name: a.name },
      version,
      parent_id: parent?.id ?? null,
      author: c.author,
      ref: c.ref,
      excerpt: c.body.slice(0, 200),
    },
    mentions: JSON.parse(c.mentions) as string[],
  });
}

function commentActionAllowed(
  method: "PATCH" | "DELETE",
  own: boolean,
  role: Parameters<typeof roleAtLeast>[0],
): boolean {
  return own || (method !== "PATCH" && roleAtLeast(role, "reviewer"));
}

function editCommentTx(
  db: Database,
  c: Comment,
  a: ArtifactRow,
  text: string,
  now: string,
): ReturnType<typeof notify> {
  const next = mentions(db, text, a);
  const added = next.filter((m) => !(JSON.parse(c.mentions) as string[]).includes(m));
  db.exec("BEGIN IMMEDIATE");
  let created: ReturnType<typeof notify>;
  try {
    db.prepare("UPDATE comments SET body = ?, mentions = ?, edited_at = ? WHERE id = ?").run(
      text,
      JSON.stringify(next),
      now,
      c.id,
    );
    created = added.length
      ? notify(db, {
          kind: "mention",
          artifact: a,
          actor: c.author,
          version: c.version,
          commentId: c.id,
          mentions: added,
          onlyMentions: true,
        })
      : [];
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return created;
}

function deleteCommentTx(
  db: Database,
  c: Comment,
  a: ArtifactRow,
  actor: string,
  own: boolean,
  now: string,
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE comments SET body = '', deleted_at = ? WHERE id = ?").run(now, c.id);
    if (!own)
      appendAudit(db, {
        ts: now,
        actor,
        artifact_id: a.id,
        version: c.version,
        action: "comment_delete",
        meta: { comment_id: c.id },
      });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const commentsRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.post<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/comments",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const a = getArtifactByTypeName(db, request.params.type, request.params.name);
      if (!a || !canView(db, request.user, a)) return reply.code(404).send({ error: "not_found" });
      const input = parseNewComment(request.body);
      if (!input.ok) {
        const error = input.status === 400 ? "comment_invalid" : "not_found";
        return reply.code(input.status).send({ error });
      }
      const thread = resolveThreadParent(db, input.value.parentId, a.id);
      if (!thread) return reply.code(404).send({ error: "not_found" });
      const parent = thread.parent;
      const version = parent ? parent.version : input.value.version;
      if (version && !getVersion(db, a.id, version))
        return reply.code(404).send({ error: "not_found" });
      const now = new Date().toISOString();
      const id = randomUUID();
      const inserted = insertCommentTx(db, {
        id,
        now,
        username: request.user.username,
        artifact: a,
        version,
        parent,
        text: input.value.text,
        ref: input.value.ref,
      });
      if (!inserted.ok) return reply.code(429).send({ error: "rate_limited" });
      const c = inserted.comment;
      emitCommentCreated(a, c, version, parent, now);
      emitNotifications(inserted.created);
      return reply.code(201).send({ comment: parsed(c) });
    },
  );

  app.get<{
    Params: { type: string; name: string };
    Querystring: { version?: string; ref?: string; limit?: string; cursor?: string };
  }>("/api/v1/artifacts/:type/:name/comments", async (request, reply) => {
    const a = getArtifactByTypeName(db, request.params.type, request.params.name);
    if (!a || !canView(db, request.user ?? null, a))
      return reply.code(404).send({ error: "not_found" });
    const q = request.query;
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const roots = db
      .prepare(
        `SELECT * FROM comments WHERE artifact_id = ? AND parent_id IS NULL
        AND (? IS NULL OR version = ?) AND (? IS NULL OR ref = ?)
        AND (? IS NULL OR (created_at, id) >
          (SELECT created_at, id FROM comments WHERE id = ? AND artifact_id = ?))
        ORDER BY created_at, id LIMIT ?`,
      )
      .all(
        a.id,
        q.version ?? null,
        q.version ?? null,
        q.ref ?? null,
        q.ref ?? null,
        q.cursor ?? null,
        q.cursor ?? null,
        a.id,
        limit + 1,
      ) as Comment[];
    const page = roots.slice(0, limit);
    const items = page.map((root) => ({
      ...parsed(root),
      replies: (
        db
          .prepare("SELECT * FROM comments WHERE parent_id = ? ORDER BY created_at, id")
          .all(root.id) as Comment[]
      ).map(parsed),
    }));
    return reply.send({ items, next_cursor: roots.length > limit ? page.at(-1)?.id : null });
  });

  for (const method of ["PATCH", "DELETE"] as const) {
    app.route<{ Params: { id: string } }>({
      method,
      url: "/api/v1/comments/:id",
      handler: async (request, reply) => {
        if (!requireUser(request, reply)) return;
        const c = db.prepare("SELECT * FROM comments WHERE id = ?").get(request.params.id) as
          Comment | undefined;
        const a = c ? getArtifactById(db, c.artifact_id) : null;
        if (!c || !a || !canView(db, request.user, a))
          return reply.code(404).send({ error: "not_found" });
        const own = c.author === request.user.username;
        if (!commentActionAllowed(method, own, request.user.role))
          return reply.code(403).send({ error: "forbidden" });
        if (c.deleted_at) return reply.code(404).send({ error: "not_found" });
        const now = new Date().toISOString();
        if (method === "PATCH") {
          const body = (request.body ?? {}) as Record<string, unknown>;
          if (!validBody(body.body)) return reply.code(400).send({ error: "comment_invalid" });
          emitNotifications(editCommentTx(db, c, a, body.body, now));
        } else {
          deleteCommentTx(db, c, a, request.user.username, own, now);
        }
        const updated = db.prepare("SELECT * FROM comments WHERE id = ?").get(c.id) as Comment;
        return reply.send({ comment: parsed(updated) });
      },
    });
  }
  app.put<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/watch",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const a = getArtifactByTypeName(db, request.params.type, request.params.name);
      if (!a || !canView(db, request.user, a)) return reply.code(404).send({ error: "not_found" });
      const watching = (request.body as { watching?: unknown } | null)?.watching;
      if (typeof watching !== "boolean") return reply.code(400).send({ error: "bad_request" });
      if (watching)
        db.prepare(
          "INSERT INTO artifact_watchers (artifact_id, username, source) VALUES (?, ?, 'manual') ON CONFLICT (artifact_id, username) DO UPDATE SET source = 'manual'",
        ).run(a.id, request.user.username);
      else
        db.prepare("DELETE FROM artifact_watchers WHERE artifact_id = ? AND username = ?").run(
          a.id,
          request.user.username,
        );
      return reply.send({ watching });
    },
  );
};
