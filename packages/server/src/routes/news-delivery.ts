// news-delivery routes: the Atom feed (by a personal token, or the public part without one), the feed by the
// personal Atom key, the key itself and the summary period. The key and the period are managed only by a signed-in
// person (a session); an MCP token never gets here (auth/guard.ts), and the key as a bearer token opens nothing.
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { requireUser } from "../auth/guard.ts";
import type { Viewer } from "../visibility/index.ts";
import { readFeedPage, toItemView } from "../news/read.ts";
import {
  ATOM_FEED_SIZE,
  atomKeyState,
  issueAtomKey,
  renderAtom,
  resolveAtomKey,
  revokeAtomKey,
} from "../news/atom.ts";
import { getSummaryPeriod, isSummaryPeriod, setSummaryPeriod } from "../news/delivery.ts";
import { linkBase } from "../news/links.ts";

export type NewsDeliveryRoutesOpts = { db: Database; config: AppConfig };

const ATOM_TYPE = "application/atom+xml; charset=utf-8";

function sendFeed(db: Database, config: AppConfig, viewer: Viewer, reply: FastifyReply) {
  const now = new Date().toISOString();
  const page = readFeedPage(
    db,
    viewer,
    {
      cursor: null,
      limit: ATOM_FEED_SIZE,
      kinds: null,
      type: null,
      team: null,
      mine: false,
      drafts: false,
    },
    now,
  );
  const items = page.rows.map((r) => toItemView(db, viewer, r, now));
  return reply
    .code(200)
    .type(ATOM_TYPE)
    .send(renderAtom(linkBase(config), items, now));
}

/** Only a sign-in session (or local mode) manages the key: a token must not mint a feed credential. */
function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): request is FastifyRequest & { user: NonNullable<FastifyRequest["user"]> } {
  if (!requireUser(request, reply)) return false;
  if (request.authVia !== "session" && request.authVia !== "local") {
    void reply.code(403).send({ error: "session_required" });
    return false;
  }
  return true;
}

function parsePeriodBody(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "period") return null;
  const period = (body as { period?: unknown }).period;
  return isSummaryPeriod(period) ? period : null;
}

export const newsDeliveryRoutes: FastifyPluginAsync<NewsDeliveryRoutesOpts> = async (
  app,
  { db, config },
) => {
  app.get("/api/v1/news.atom", async (request, reply) => {
    if (!request.user && !config.publicRead) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const viewer = request.user
      ? { username: request.user.username, role: request.user.role }
      : null;
    return sendFeed(db, config, viewer, reply);
  });

  app.get<{ Params: { key: string } }>("/api/v1/news/atom/:key", async (request, reply) => {
    const owner = resolveAtomKey(db, request.params.key);
    if (!owner) return reply.code(404).send({ error: "not_found" });
    return sendFeed(db, config, owner, reply);
  });

  app.get("/api/v1/me/news-atom-key", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    return reply.send(atomKeyState(db, request.user.username));
  });

  app.post("/api/v1/me/news-atom-key", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const issued = issueAtomKey(db, request.user.username, new Date().toISOString());
    return reply.code(201).send({
      key: issued.key,
      url: `${linkBase(config)}/api/v1/news/atom/${issued.key}`,
      prefix: issued.prefix,
      created_at: issued.created_at,
    });
  });

  app.delete("/api/v1/me/news-atom-key", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    revokeAtomKey(db, request.user.username);
    return reply.code(204).send();
  });

  app.get("/api/v1/me/news-summary", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return reply.send({ period: getSummaryPeriod(db, request.user.username) });
  });

  app.put("/api/v1/me/news-summary", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const period = parsePeriodBody(request.body);
    if (!period || !isSummaryPeriod(period)) {
      return reply.code(400).send({ error: "bad_request", fields: ["period"] });
    }
    setSummaryPeriod(db, request.user.username, period);
    return reply.send({ period });
  });
};
