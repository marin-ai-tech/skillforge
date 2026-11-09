import type { FastifyPluginAsync } from "fastify";
import { requireUser } from "../auth/guard.ts";
import { ReplacementError, setReplacement } from "../replacement.ts";
import { getArtifactByTypeName, type Database } from "../repo.ts";

/** "Replaced by" (artifact-replacement); visibility is checked by the global gate for `/:type/:name`. */
export const replacementRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;
  app.put<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/replacement",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const row = getArtifactByTypeName(db, request.params.type, request.params.name);
      if (!row || row.purged_at) return reply.code(404).send({ error: "not_found" });
      try {
        const replaced_by = setReplacement(db, request.user, row, request.body);
        return reply.send({ replaced_by });
      } catch (e) {
        if (e instanceof ReplacementError) {
          return reply.code(e.status).send({ error: e.code, message: e.message });
        }
        throw e;
      }
    },
  );
};
