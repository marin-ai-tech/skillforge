import { appendSystemEvent } from "../audit/journal.ts";
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/guard.ts";
import type { Database } from "../db.ts";
import {
  PolicyError,
  applyPolicyPatch,
  loadImportPolicy,
  saveImportPolicy,
} from "../imports/policy.ts";

/** Import source policy for admins. */
export const adminImportPolicyRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;

  app.get("/api/v1/admin/import-policy", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    return reply.code(200).send({ policy: loadImportPolicy(db) });
  });

  app.put("/api/v1/admin/import-policy", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    let next;
    try {
      next = applyPolicyPatch(loadImportPolicy(db), request.body);
    } catch (e) {
      if (e instanceof PolicyError) {
        return reply
          .code(400)
          .send({ error: "invalid_policy", field: e.field, message: e.message });
      }
      throw e;
    }
    saveImportPolicy(db, next, request.user.username);
    appendSystemEvent(db, {
      actor: request.user.username,
      action: "import_policy_change",
      meta: { policy: next },
    });
    request.log.info(
      { event: "import_policy_change", actor: request.user.username, policy: next },
      "import policy changed",
    );
    return reply.code(200).send({ policy: next });
  });
};
