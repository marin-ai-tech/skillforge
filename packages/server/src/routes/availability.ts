import type { FastifyPluginAsync } from "fastify";
import { requireUser } from "../auth/guard.ts";
import {
  AvailabilityError,
  assignmentsFor,
  listAvailability,
  setAvailability,
} from "../availability.ts";
import { getArtifactByTypeName, type Database } from "../repo.ts";

/** Availability per team (team-availability); visibility is checked by the global gate for `/:type/:name`. */
export const availabilityRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/availability",
    async (request, reply) => {
      const row = getArtifactByTypeName(db, request.params.type, request.params.name);
      if (!row) return reply.code(404).send({ error: "not_found" });
      return reply.send({ items: listAvailability(db, row.id) });
    },
  );

  app.put<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/availability",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const row = getArtifactByTypeName(db, request.params.type, request.params.name);
      if (!row) return reply.code(404).send({ error: "not_found" });
      try {
        setAvailability(db, request.user, row, request.body);
      } catch (e) {
        if (e instanceof AvailabilityError) return reply.code(e.status).send({ error: e.code });
        throw e;
      }
      return reply.send({ items: listAvailability(db, row.id) });
    },
  );

  app.get("/api/v1/me/assignments", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return reply.send(
      assignmentsFor(db, { username: request.user.username, role: request.user.role }),
    );
  });
};
