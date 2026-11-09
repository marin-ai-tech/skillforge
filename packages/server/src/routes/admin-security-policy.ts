import { appendSystemEvent } from "../audit/journal.ts";
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/guard.ts";
import type { Database } from "../db.ts";
import {
  SecurityPolicyError,
  applySecurityPatch,
  loadSecurityPolicy,
  saveSecurityPolicy,
} from "../security/policy.ts";

/** Publish blocking by content scan, for admins (content-security-scan). */
export const adminSecurityPolicyRoutes: FastifyPluginAsync<{ db: Database }> = async (
  app,
  opts,
) => {
  const { db } = opts;

  app.get("/api/v1/admin/security-policy", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    return reply.code(200).send({ policy: loadSecurityPolicy(db) });
  });

  app.put("/api/v1/admin/security-policy", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    let next;
    try {
      next = applySecurityPatch(loadSecurityPolicy(db), request.body);
    } catch (e) {
      if (e instanceof SecurityPolicyError) {
        return reply.code(400).send({ error: "invalid_policy", message: e.message });
      }
      throw e;
    }
    saveSecurityPolicy(db, next, request.user.username);
    appendSystemEvent(db, {
      actor: request.user.username,
      action: "security_policy_change",
      meta: { policy: next },
    });
    request.log.info(
      { event: "security_policy_change", actor: request.user.username, policy: next },
      "security policy changed",
    );
    return reply.code(200).send({ policy: next });
  });
};
