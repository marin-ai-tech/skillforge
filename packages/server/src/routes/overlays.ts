import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { isArtifactType } from "@skillforge/core";
import { requireUser } from "../auth/guard.ts";
import { appendSystemEvent } from "../audit/journal.ts";
import type { Database } from "../db.ts";
import {
  OverlayError,
  layersFor,
  parseOverlay,
  saveOverlay,
  supportsOverlays,
} from "../overlays/overlays.ts";
import { getArtifactByTypeName } from "../repo.ts";
import { getTeamByName, teamRoleByUsername } from "../teams.ts";

type Params = { type: string; name: string };

/** Layers of edits over an artifact (artifact-overlays); visibility is checked by the global gate for `/:type/:name`. */
export const overlayRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;

  function artifactOf(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply) {
    const { type, name } = request.params;
    const row = isArtifactType(type) ? getArtifactByTypeName(db, type, name) : undefined;
    if (!row || row.purged_at) {
      void reply.code(404).send({ error: "not_found" });
      return null;
    }
    if (!supportsOverlays(type)) {
      void reply.code(422).send({ error: "type_not_supported" });
      return null;
    }
    return row;
  }

  async function save(
    request: FastifyRequest<{ Params: Params }>,
    reply: FastifyReply,
    scope: string,
    label: string,
  ) {
    const row = artifactOf(request, reply);
    if (!row) return;
    let ops;
    try {
      ops = parseOverlay(request.body, row.type as Parameters<typeof parseOverlay>[1], row.name);
    } catch (e) {
      if (e instanceof OverlayError)
        return reply.code(400).send({ error: "bad_request", message: e.message });
      throw e;
    }
    saveOverlay(db, row.id, scope, ops, request.user!.username);
    appendSystemEvent(db, {
      actor: request.user!.username,
      action: "overlay_change",
      target: `${row.type}/${row.name}`,
      meta: { scope: label, ops: ops.length },
    });
    return reply.send({ scope: label, ops });
  }

  app.get<{ Params: Params }>("/api/v1/artifacts/:type/:name/overlays", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const row = artifactOf(request, reply);
    if (!row) return;
    return reply.send({ layers: layersFor(db, row.id, request.user.username) });
  });

  app.put<{ Params: Params }>(
    "/api/v1/artifacts/:type/:name/overlays/company",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      if (request.user.role !== "admin") return reply.code(403).send({ error: "forbidden" });
      return save(request, reply, "company", "company");
    },
  );

  app.put<{ Params: Params & { team: string } }>(
    "/api/v1/artifacts/:type/:name/overlays/team/:team",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const team = getTeamByName(db, request.params.team);
      if (!team) return reply.code(404).send({ error: "not_found" });
      const lead = teamRoleByUsername(db, team.name, request.user.username) === "lead";
      if (!lead && request.user.role !== "admin")
        return reply.code(403).send({ error: "forbidden" });
      return save(request, reply, `team:${team.id}`, `team:${team.name}`);
    },
  );

  app.put<{ Params: Params }>(
    "/api/v1/artifacts/:type/:name/overlays/me",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const me = request.user.username.toLowerCase();
      return save(request, reply, `user:${me}`, `user:${me}`);
    },
  );
};
