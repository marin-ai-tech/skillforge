import type { FastifyPluginAsync } from "fastify";
import { actorFromRequest } from "../actor.ts";
import { requireUser } from "../auth/guard.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../repo.ts";
import {
  MAX_SESSION_FACTS_BODY,
  acceptSessionFacts,
  deleteSessionFacts,
  parseAcceptBody,
} from "../sessions/facts.ts";

export type SessionFactsPluginOpts = {
  db: Database;
  config: AppConfig;
};

export const sessionFactsRoutes: FastifyPluginAsync<SessionFactsPluginOpts> = async (app, opts) => {
  const { db } = opts;

  app.post(
    "/api/v1/me/session-facts",
    {
      bodyLimit: MAX_SESSION_FACTS_BODY,
    },
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const parsed = parseAcceptBody(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      const result = acceptSessionFacts(db, {
        reporter: actorFromRequest(request),
        source: parsed.source,
        facts: parsed.facts,
        viewer: { username: request.user!.username, role: request.user!.role },
      });
      if (result.kind === "bad_request") {
        return reply.code(400).send({ error: result.error });
      }
      if (result.kind === "rate_limited") {
        return reply.code(429).send({ error: "rate_limited" });
      }
      return reply.code(200).send(result.counters);
    },
  );

  app.delete<{ Querystring: { source?: string } }>(
    "/api/v1/me/session-facts",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const source = typeof request.query.source === "string" ? request.query.source : undefined;
      const deleted = deleteSessionFacts(db, actorFromRequest(request), source);
      return reply.code(200).send({ deleted });
    },
  );
};
