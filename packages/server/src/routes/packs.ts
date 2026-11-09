import type { FastifyPluginAsync } from "fastify";
import { requireRole, requireUser } from "../auth/guard.ts";
import type { Database } from "../db.ts";
import {
  PackError,
  checkPackItems,
  getPack,
  listPacks,
  packVersion,
  packView,
  parsePackBody,
  publishPack,
} from "../packs/packs.ts";

/** Team method packs (method-packs): contributors publish, everyone signed in reads. */
export const packRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;

  app.post("/api/v1/packs", async (request, reply) => {
    if (!requireRole(request, reply, "contributor")) return;
    try {
      const input = parsePackBody(request.body);
      checkPackItems(db, input.manifest);
      publishPack(db, { username: request.user.username, role: request.user.role }, input);
      return reply.code(201).send(packView(db, getPack(db, input.name)!));
    } catch (e) {
      if (e instanceof PackError)
        return reply.code(e.status).send({ error: e.code, message: e.message });
      throw e;
    }
  });

  app.get("/api/v1/packs", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    return reply.send({ items: listPacks(db) });
  });

  app.get<{ Params: { name: string } }>("/api/v1/packs/:name", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const row = getPack(db, request.params.name);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send(packView(db, row));
  });

  app.get<{ Params: { name: string; version: string } }>(
    "/api/v1/packs/:name/versions/:version",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const row = getPack(db, request.params.name);
      const v = row ? packVersion(db, row, request.params.version) : null;
      if (!v) return reply.code(404).send({ error: "not_found" });
      return reply.send({ version: v });
    },
  );
};
