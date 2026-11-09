import { appendSystemEvent } from "../audit/journal.ts";
import { stripUserinfo } from "../imports/sources.ts";
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/guard.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import {
  MirrorInputError,
  createMirror,
  deleteMirror,
  getMirror,
  listMirrors,
  syncMirror,
} from "../imports/mirror.ts";

/** Upstream mirrors for admins. */
export const adminMirrorRoutes: FastifyPluginAsync<{ db: Database; config: AppConfig }> = async (
  app,
  opts,
) => {
  const { db, config } = opts;

  app.get("/api/v1/admin/mirrors", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    return reply.code(200).send({ items: listMirrors(db) });
  });

  app.post("/api/v1/admin/mirrors", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    try {
      const mirror = createMirror(db, config, request.body, request.user.username);
      appendSystemEvent(db, {
        actor: request.user.username,
        action: "mirror_create",
        target: mirror.id,
        meta: { url: stripUserinfo(mirror.url) },
      });
      return reply.code(201).send({ mirror });
    } catch (e) {
      if (e instanceof MirrorInputError) {
        return reply.code(e.status).send({ error: e.code, message: e.message });
      }
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/mirrors/:id/check",
    async (request, reply) => {
      if (!requireRole(request, reply, "admin")) return;
      const mirror = getMirror(db, request.params.id);
      if (!mirror) return reply.code(404).send({ error: "not_found" });
      const report = await syncMirror(db, config, mirror, {
        username: request.user.username,
        role: request.user.role,
      });
      return reply.code(200).send({ report });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/v1/admin/mirrors/:id", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    if (!deleteMirror(db, request.params.id)) return reply.code(404).send({ error: "not_found" });
    appendSystemEvent(db, {
      actor: request.user.username,
      action: "mirror_delete",
      target: request.params.id,
    });
    return reply.code(204).send();
  });
};
