import type { FastifyPluginAsync } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { requireRole } from "../auth/guard.ts";
import { countInstalled, installStarterPack } from "../starter-packs/install.ts";
import { isSafePackId, loadStarterPacks } from "../starter-packs/load.ts";

export type AdminStarterPacksOpts = {
  db: Database;
  config: AppConfig;
};

export const adminStarterPacksRoutes: FastifyPluginAsync<AdminStarterPacksOpts> = async (
  app,
  opts,
) => {
  const { db, config } = opts;

  app.get("/api/v1/admin/starter-packs", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const packs = loadStarterPacks(config.starterPacksDir);
    const items = packs.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      license: p.license,
      artifacts: p.artifacts.length,
      installed: countInstalled(db, p),
    }));
    return reply.code(200).send({ items });
  });

  app.post<{ Params: { id: string } }>(
    "/api/v1/admin/starter-packs/:id/install",
    async (request, reply) => {
      if (!requireRole(request, reply, "admin")) return;
      const id = request.params.id;
      // Reject path-like or non-kebab ids before filesystem lookup (defense in depth).
      if (!isSafePackId(id)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const actor = request.user.username;
      const result = installStarterPack(
        db,
        config.dataDir,
        config.starterPacksDir,
        id,
        actor,
        request.user.role,
      );
      if (!result.ok) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.code(200).send({ results: result.results });
    },
  );
};
