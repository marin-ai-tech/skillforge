import { appendSystemEvent } from "../audit/journal.ts";
import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "../auth/guard.ts";
import type { Database } from "../db.ts";
import {
  McpPolicyError,
  applyMcpPolicyPatch,
  loadMcpPolicy,
  saveMcpPolicy,
} from "../mcp-policy/policy.ts";

/** Which MCP package types and remote origins may be published, for admins (mcp-policy). */
export const adminMcpPolicyRoutes: FastifyPluginAsync<{ db: Database }> = async (app, opts) => {
  const { db } = opts;

  app.get("/api/v1/admin/mcp-policy", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    return reply.code(200).send({ policy: loadMcpPolicy(db) });
  });

  app.put("/api/v1/admin/mcp-policy", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    let next;
    try {
      next = applyMcpPolicyPatch(loadMcpPolicy(db), request.body);
    } catch (e) {
      if (e instanceof McpPolicyError) {
        return reply.code(400).send({ error: "invalid_policy", message: e.message });
      }
      throw e;
    }
    saveMcpPolicy(db, next, request.user.username);
    appendSystemEvent(db, {
      actor: request.user.username,
      action: "mcp_policy_change",
      meta: { policy: next },
    });
    request.log.info(
      { event: "mcp_policy_change", actor: request.user.username, policy: next },
      "MCP policy changed",
    );
    return reply.code(200).send({ policy: next });
  });
};
