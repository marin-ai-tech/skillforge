import type { FastifyPluginAsync } from "fastify";
import { requireRole, requireUser } from "../auth/guard.ts";
import type { Database } from "../db.ts";
import {
  PackError,
  getPack,
  listPacks,
  packVersion,
  packView,
  parsePackBody,
  publishPack,
} from "../packs/packs.ts";
import { methodPackItemProblems, methodPackOwnProblems } from "../packs/check.ts";

/** Team method packs (method-packs): contributors publish, everyone signed in reads. */
export const packRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;

  app.post("/api/v1/packs", async (request, reply) => {
    if (!requireRole(request, reply, "contributor")) return;
    try {
      const input = parsePackBody(request.body);
      const actor = { username: request.user.username, role: request.user.role };
      const problems = methodPackItemProblems(db, actor, input.manifest);
      const first = problems[0];
      if (first)
        return reply.code(422).send({ error: first.code, message: first.message, problems });
      publishPack(db, actor, input);
      return reply.code(201).send(packView(db, getPack(db, input.name)!));
    } catch (e) {
      if (e instanceof PackError)
        return reply.code(e.status).send({ error: e.code, message: e.message });
      throw e;
    }
  });

  /** pack-authoring: the same checks as publishing, every problem at once, nothing written. */
  app.post("/api/v1/packs/check", async (request, reply) => {
    if (!requireRole(request, reply, "contributor")) return;
    try {
      const input = parsePackBody(request.body);
      const actor = { username: request.user.username, role: request.user.role };
      const problems = [
        ...methodPackOwnProblems(db, actor, input.name, input.version),
        ...methodPackItemProblems(db, actor, input.manifest),
      ];
      return reply.send({ ok: problems.length === 0, problems });
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
