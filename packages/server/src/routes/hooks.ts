import type { FastifyPluginAsync } from "fastify";
import type { Database } from "../db.ts";
import { requireRole, requireUser } from "../auth/guard.ts";
import { actorFromRequest } from "../actor.ts";
import { appendAudit, getArtifactByTypeName, getVersion } from "../repo.ts";
import {
  countDecisions,
  createSubscription,
  deleteSubscription,
  findSubscription,
  getSubscription,
  listDecisions,
  listSubscriptions,
  setSubscriptionEnabled,
} from "../hooks/model.ts";
import { evaluateHooks } from "../hooks/engine.ts";

export type HooksPluginOpts = {
  db: Database;
  dataDir: string;
  /** Operator switch (SKILLFORGE_ORCHESTRATION_ENABLED): off → all routes 403 feature_disabled. */
  enabled: boolean;
  /** Kill switch (SKILLFORGE_HOOKS_DISABLED): evaluate → allow without executing or auditing. */
  hooksDisabled: boolean;
};

const EVENT_MAX = 64;

function auditSub(
  db: Database,
  artifactId: string,
  version: string,
  actor: string,
  action: string,
): void {
  appendAudit(db, {
    ts: new Date().toISOString(),
    actor,
    artifact_id: artifactId,
    version,
    action,
  });
}

export const hooksRoutes: FastifyPluginAsync<HooksPluginOpts> = async (app, opts) => {
  const { db, dataDir, enabled, hooksDisabled } = opts;

  if (!enabled) {
    app.addHook("onRequest", async (_request, reply) => {
      return reply.code(403).send({ error: "feature_disabled", feature: "orchestration" });
    });
  }

  app.get("/api/v1/hooks/subscriptions", async (request, reply) => {
    if (!requireRole(request, reply, "reviewer")) return;
    return { items: listSubscriptions(db) };
  });

  app.post("/api/v1/hooks/subscriptions", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const type = typeof body.type === "string" ? body.type : "";
    const name = typeof body.name === "string" ? body.name : "";
    const version = typeof body.version === "string" ? body.version : "";
    if (!type || !name || !version) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "type, name, version required" });
    }
    const art = getArtifactByTypeName(db, type, name);
    if (!art || art.purged_at) return reply.code(404).send({ error: "not_found" });
    if (art.type !== "hook") {
      return reply.code(422).send({ error: "not_a_hook", message: "artifact is not a hook" });
    }
    if (!getVersion(db, art.id, version)) {
      return reply.code(404).send({ error: "version_not_found" });
    }
    if (findSubscription(db, art.id, version)) {
      return reply.code(409).send({ error: "subscription_exists" });
    }
    const actor = actorFromRequest(request);
    const sub = createSubscription(db, {
      artifact_id: art.id,
      artifact_type: art.type,
      artifact_name: art.name,
      version,
      created_by: actor,
    });
    auditSub(db, art.id, version, actor, "hook_subscribed");
    return reply.code(201).send({ subscription: sub });
  });

  app.delete<{ Params: { id: string } }>(
    "/api/v1/hooks/subscriptions/:id",
    async (request, reply) => {
      if (!requireRole(request, reply, "admin")) return;
      const sub = getSubscription(db, Number(request.params.id));
      if (!sub) return reply.code(404).send({ error: "not_found" });
      // Append-only audit: a subscription with recorded decisions can't be
      // deleted (FK + audit trail); disable it instead.
      if (countDecisions(db, sub.id) > 0) {
        return reply.code(409).send({ error: "has_decisions" });
      }
      deleteSubscription(db, sub.id);
      auditSub(db, sub.artifact_id, sub.version, actorFromRequest(request), "hook_unsubscribed");
      return reply.code(204).send();
    },
  );

  for (const [verb, enabled] of [
    ["enable", true],
    ["disable", false],
  ] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/v1/hooks/subscriptions/:id/${verb}`,
      async (request, reply) => {
        if (!requireRole(request, reply, "admin")) return;
        const sub = getSubscription(db, Number(request.params.id));
        if (!sub) return reply.code(404).send({ error: "not_found" });
        setSubscriptionEnabled(db, sub.id, enabled);
        auditSub(
          db,
          sub.artifact_id,
          sub.version,
          actorFromRequest(request),
          enabled ? "hook_enabled" : "hook_disabled",
        );
        return { id: sub.id, enabled: enabled ? 1 : 0 };
      },
    );
  }

  app.post("/api/v1/hooks/evaluate", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    // Executes arbitrary hook commands on the host — same restriction as
    // workflow/routine mutation: no MCP tokens, contributor+.
    if (!requireRole(request, reply, "contributor")) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const event = typeof body.event === "string" ? body.event : "";
    if (!event || event.length > EVENT_MAX) {
      return reply
        .code(400)
        .send({ error: "bad_request", message: "event: non-empty string ≤ 64 chars" });
    }
    const toolName =
      typeof body.tool_name === "string" && body.tool_name !== "" ? body.tool_name : undefined;
    const result = await evaluateHooks(
      db,
      dataDir,
      {
        event,
        toolName,
        input: body.input,
        actor: actorFromRequest(request),
      },
      { hooksDisabled },
    );
    return result;
  });

  app.get("/api/v1/hooks/decisions", async (request, reply) => {
    if (!requireRole(request, reply, "reviewer")) return;
    const limit =
      typeof (request.query as Record<string, unknown>).limit === "string"
        ? Math.min(1000, Math.max(1, Number((request.query as Record<string, unknown>).limit)))
        : 200;
    return { items: listDecisions(db, Number.isFinite(limit) ? limit : 200) };
  });
};
