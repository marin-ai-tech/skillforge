// news routes: the feed, the reader's "seen" mark and posts. Rights are checked on every request (news/read.ts for
// reading, news/posts.ts for writing); MCP tokens never get here (auth/guard.ts).
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { isArtifactType } from "@skillforge/core";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { requireUser } from "../auth/guard.ts";
import { parseQueryFlag } from "../lib/query-flag.ts";
import type { Viewer } from "../visibility/index.ts";
import { isNewsKind, type NewsKind } from "../news/rules.ts";
import { requestAnnounce } from "../news/announce-trigger.ts";
import {
  decodeCursor,
  encodeCursor,
  getSeenAt,
  markSeen,
  readFeedPage,
  readPinned,
  readPostRow,
  toItemView,
  unreadCount,
  type FeedQuery,
  type NewsRow,
} from "../news/read.ts";
import {
  audienceRefusal,
  deletePost,
  insertPost,
  mergePatch,
  parsePostCreate,
  parsePostPatch,
  scheduleRefusal,
  updatePost,
  type Refusal,
  type Writer,
} from "../news/posts.ts";

export type NewsRoutesOpts = { db: Database; config: AppConfig };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type FeedParams = Record<string, string | undefined>;

function viewerOf(request: FastifyRequest): Viewer {
  return request.user ? { username: request.user.username, role: request.user.role } : null;
}

function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, MAX_LIMIT);
}

function parseKinds(raw: string | undefined): NewsKind[] | null | false {
  if (raw === undefined || raw === "") return null;
  const kinds = raw.split(",").map((k) => k.trim());
  return kinds.every(isNewsKind) ? kinds : false;
}

function parseType(raw: string | undefined): string | null | false {
  if (raw === undefined || raw === "") return null;
  return isArtifactType(raw) ? raw : false;
}

function parseCursor(raw: string | undefined): FeedQuery["cursor"] | false {
  if (raw === undefined || raw === "") return null;
  return decodeCursor(raw) ?? false;
}

/** news-delivery: `since` — an ISO 8601 time, normalised; anything else is malformed. */
function parseSince(raw: string | undefined): string | null | false {
  if (raw === undefined || raw === "") return null;
  const t = Date.parse(raw);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) && Number.isFinite(t) ? new Date(t).toISOString() : false;
}

/** Query string → typed query; null on any malformed parameter. */
export function parseFeedQuery(q: FeedParams): FeedQuery | null {
  const limit = parseLimit(q.limit);
  const kinds = parseKinds(q.kind);
  const type = parseType(q.type);
  const cursor = parseCursor(q.cursor);
  const since = parseSince(q.since);
  const unread = parseQueryFlag(q.unread);
  const mine = parseQueryFlag(q.mine);
  const drafts = parseQueryFlag(q.drafts);
  if (limit === null || kinds === false || type === false || cursor === false) return null;
  if (since === false || unread === null || mine === null || drafts === null) return null;
  return {
    since,
    unread,
    cursor,
    limit,
    kinds,
    type,
    team: q.team ? q.team : null,
    mine,
    drafts,
  };
}

function send(reply: FastifyReply, refusal: Refusal) {
  return reply.code(refusal.status).send(refusal.body);
}

function writerOf(request: FastifyRequest & { user: NonNullable<FastifyRequest["user"]> }): Writer {
  return { username: request.user.username, role: request.user.role };
}

function postId(raw: string): number | null {
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

/** A post the viewer can see, or 404; one the viewer can see but not edit, 403. */
function editablePost(
  db: Database,
  viewer: Viewer,
  rawId: string,
  now: string,
): { row: NewsRow } | { refusal: Refusal } {
  const id = postId(rawId);
  const row = id === null ? undefined : readPostRow(db, viewer, id, now);
  if (!row) return { refusal: { status: 404, body: { error: "not_found" } } };
  if (Number(row.editable) !== 1) return { refusal: { status: 403, body: { error: "forbidden" } } };
  return { row };
}

function feedHandler(db: Database, config: AppConfig) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user && !config.publicRead) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const q = parseFeedQuery(request.query as FeedParams);
    if (!q) return reply.code(400).send({ error: "bad_request" });
    const viewer = viewerOf(request);
    const now = new Date().toISOString();
    const seenAt = viewer ? getSeenAt(db, viewer.username) : null;
    const page = readFeedPage(db, viewer, { ...q, seenAt }, now);
    const last = page.rows.at(-1);
    return reply.send({
      items: page.rows.map((r) => toItemView(db, viewer, r, now)),
      pinned: q.cursor
        ? []
        : readPinned(db, viewer, now).map((r) => toItemView(db, viewer, r, now)),
      unread_count: unreadCount(db, viewer, now),
      next_cursor: page.hasMore && last ? encodeCursor(last) : null,
      seen_at: seenAt,
    });
  };
}

function parseSeenAt(body: unknown): string | null | false {
  if (body === undefined || body === null) return null;
  if (typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  if (keys.some((k) => k !== "at")) return false;
  const at = (body as { at?: unknown }).at;
  if (at === undefined || at === null) return null;
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) return false;
  return new Date(at).toISOString();
}

export const newsRoutes: FastifyPluginAsync<NewsRoutesOpts> = async (app, { db, config }) => {
  app.get("/api/v1/news", feedHandler(db, config));

  app.post("/api/v1/news/seen", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const at = parseSeenAt(request.body);
    if (at === false) return reply.code(400).send({ error: "bad_request" });
    const now = new Date().toISOString();
    const mark = markSeen(db, viewerOf(request)!, at, now);
    return reply.send({
      seen_at: mark.seen_at,
      previous_seen_at: mark.previous_seen_at,
      unread_count: unreadCount(db, viewerOf(request), now),
    });
  });

  app.post("/api/v1/news/posts", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const parsed = parsePostCreate(request.body);
    if ("refusal" in parsed) return send(reply, parsed.refusal);
    const writer = writerOf(request);
    const input = parsed.value;
    const now = new Date();
    const refusal =
      audienceRefusal(db, writer, input.team ?? null) ??
      scheduleRefusal(input.publish_at ?? null, input.expires_at ?? null, now.toISOString(), now);
    if (refusal) return send(reply, refusal);
    const id = insertPost(db, writer, input, now.toISOString());
    requestAnnounce(); // news-delivery: a post due now goes to plugins after this write
    const nowIso = now.toISOString();
    const row = readPostRow(db, viewerOf(request), id, nowIso)!;
    return reply.code(201).send(toItemView(db, viewerOf(request), row, nowIso));
  });

  app.get<{ Params: { id: string } }>("/api/v1/news/posts/:id", async (request, reply) => {
    if (!request.user && !config.publicRead) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const now = new Date().toISOString();
    const id = postId(request.params.id);
    const viewer = viewerOf(request);
    const row = id === null ? undefined : readPostRow(db, viewer, id, now);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send(toItemView(db, viewer, row, now));
  });

  app.patch<{ Params: { id: string } }>("/api/v1/news/posts/:id", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const viewer = viewerOf(request);
    const now = new Date();
    const nowIso = now.toISOString();
    const found = editablePost(db, viewer, request.params.id, nowIso);
    if ("refusal" in found) return send(reply, found.refusal);
    const parsed = parsePostPatch(request.body);
    if ("refusal" in parsed) return send(reply, parsed.refusal);
    const merged = mergePatch(found.row, parsed.value);
    const writer = writerOf(request);
    const refusal =
      (parsed.value.team !== undefined ? audienceRefusal(db, writer, merged.team) : null) ??
      scheduleRefusal(merged.publish_at, merged.expires_at, found.row.at, now);
    if (refusal) return send(reply, refusal);
    updatePost(db, writer.username, found.row, merged, nowIso);
    requestAnnounce(); // a draft that goes out, or a schedule moved to now
    const row = readPostRow(db, viewer, found.row.id, nowIso);
    return reply.send(row ? toItemView(db, viewer, row, nowIso) : { id: String(found.row.id) });
  });

  app.delete<{ Params: { id: string } }>("/api/v1/news/posts/:id", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const found = editablePost(db, viewerOf(request), request.params.id, new Date().toISOString());
    if ("refusal" in found) return send(reply, found.refusal);
    deletePost(db, request.user.username, found.row);
    return reply.send({ id: String(found.row.id), deleted: true });
  });
};
