import type { FastifyPluginAsync } from "fastify";
import { requireRole, requireUser } from "../auth/guard.ts";
import { appendSystemEvent } from "../audit/journal.ts";
import type { Database } from "../db.ts";
import {
  EMPTY_RUBRIC,
  RubricError,
  loadRubric,
  looserThan,
  parseRubric,
  saveRubric,
} from "../quality/rubric.ts";
import { getTeamByName, teamRoleByUsername } from "../teams.ts";

/** Company and team quality rules (quality-rubric). Reading is open to anyone signed in, like the quality report. */
export const qualityRubricRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;
  const company = () => loadRubric(db, null) ?? EMPTY_RUBRIC;

  app.get("/api/v1/admin/quality-rubric", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return reply.send({ rubric: company() });
  });

  app.put("/api/v1/admin/quality-rubric", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    let rubric;
    try {
      rubric = parseRubric(request.body);
    } catch (e) {
      if (e instanceof RubricError)
        return reply.code(400).send({ error: "bad_request", message: e.message });
      throw e;
    }
    saveRubric(db, null, rubric, request.user.username);
    appendSystemEvent(db, {
      actor: request.user.username,
      action: "quality_rubric_change",
      target: "company",
      meta: { rubric },
    });
    return reply.send({ rubric });
  });

  app.get<{ Params: { name: string } }>(
    "/api/v1/teams/:name/quality-rubric",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      if (!getTeamByName(db, request.params.name))
        return reply.code(404).send({ error: "not_found" });
      return reply.send({
        rubric: loadRubric(db, request.params.name) ?? EMPTY_RUBRIC,
        company: company(),
      });
    },
  );

  app.put<{ Params: { name: string } }>(
    "/api/v1/teams/:name/quality-rubric",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const team = request.params.name;
      if (!getTeamByName(db, team)) return reply.code(404).send({ error: "not_found" });
      const lead = teamRoleByUsername(db, team, request.user.username) === "lead";
      if (!lead && request.user.role !== "admin")
        return reply.code(403).send({ error: "forbidden" });
      let rubric;
      try {
        rubric = parseRubric(request.body);
      } catch (e) {
        if (e instanceof RubricError)
          return reply.code(400).send({ error: "bad_request", message: e.message });
        throw e;
      }
      const looser = looserThan(company(), rubric);
      if (looser.length > 0)
        return reply.code(400).send({ error: "rubric_looser", fields: looser });
      saveRubric(db, team, rubric, request.user.username);
      appendSystemEvent(db, {
        actor: request.user.username,
        action: "quality_rubric_change",
        target: team,
        meta: { rubric },
      });
      return reply.send({ rubric });
    },
  );
};
